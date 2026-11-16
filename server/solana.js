'use strict';
/* Nerby Protocol — Solana support. Solana is not an EVM chain, so it gets its own read tools:
   balances, SPL tokens, blocks (slots), transactions, accounts, fees and a token safety check. */

const RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VVhdWfdbBcjRk9ytb4tUHBHKF7wXHg';
const LAMPORTS = 1e9;

class SolanaError extends Error {}

const isAddress = (v) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const isSignature = (v) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v);
function address(v, label) { if (!isAddress(v)) throw new SolanaError(`${label} must be a Solana address (base58, 32–44 characters).`); return v; }

// tries each public RPC in turn: they rate-limit and some block heavier methods
async function rpc(method, params) {
  const list = process.env.RPC_SOLANA ? [process.env.RPC_SOLANA].concat(RPCS) : RPCS;
  let last = 'no answer';
  for (const url of list) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }), signal: AbortSignal.timeout(15000) });
      } catch (e) { last = e.name === 'TimeoutError' ? 'timed out' : e.message; break; }
      if (res.status === 429) { last = 'rate limited'; await new Promise((ok) => setTimeout(ok, 500 + attempt * 500)); continue; }
      if (!res.ok) { last = 'HTTP ' + res.status; break; }
      const body = await res.json();
      if (body.error) {
        if (/blocked|not available|unsupported|rate/i.test(body.error.message || '')) { last = body.error.message; break; }
        throw new SolanaError('Solana RPC: ' + body.error.message);
      }
      return body.result;
    }
  }
  throw new SolanaError('Could not reach a Solana RPC (' + last + ').');
}

const sol = (lamports) => (Number(lamports) / LAMPORTS).toLocaleString('en-US', { maximumFractionDigits: 9, useGrouping: false });
const iso = (t) => (t ? new Date(t * 1000).toISOString() : null);

async function balance(a) {
  const r = await rpc('getBalance', [address(a.address, 'address'), { commitment: 'confirmed' }]);
  return { address: a.address, network: 'solana', balance: sol(r.value), symbol: 'SOL', lamports: String(r.value) };
}

async function mintInfo(mint) {
  const r = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const v = r && r.value;
  if (!v) throw new SolanaError('No account exists at ' + mint + '.');
  const p = v.data && v.data.parsed;
  if (!p || p.type !== 'mint') throw new SolanaError(mint + ' is not an SPL token mint.');
  return { info: p.info, program: v.owner, extensions: p.info.extensions || [] };
}

async function tokenBalance(a) {
  const owner = address(a.address, 'address'), mint = address(a.token, 'token');
  const [m, r] = await Promise.all([mintInfo(mint), rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }])]);
  let raw = 0n;
  for (const acc of r.value || []) raw += BigInt(acc.account.data.parsed.info.tokenAmount.amount);
  const dec = m.info.decimals, s = raw.toString().padStart(dec + 1, '0');
  const ui = (s.slice(0, s.length - dec) + (dec ? '.' + s.slice(-dec) : '')).replace(/\.?0+$/, '') || '0';
  return { token: mint, holder: owner, network: 'solana', balance: ui, decimals: dec, raw: raw.toString(), tokenAccounts: (r.value || []).length };
}

async function block(a) {
  let slot = a.block === undefined || a.block === null || a.block === '' || a.block === 'latest' ? await rpc('getSlot', [{ commitment: 'confirmed' }]) : Number(a.block);
  if (!Number.isInteger(slot) || slot < 0) throw new SolanaError('block must be a slot number or "latest".');
  // the newest slots are sometimes skipped or not yet served; step back a little if so
  for (let i = 0; i < 6; i++) {
    try {
      const b = await rpc('getBlock', [slot, { encoding: 'json', transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      if (b) return { network: 'solana', number: slot, slot, hash: b.blockhash, parentSlot: b.parentSlot, blockHeight: b.blockHeight, timestamp: iso(b.blockTime), transactionCount: (b.signatures || []).length };
    } catch (e) { if (!/skipped|not available|missing/i.test(e.message)) throw e; }
    slot -= 1;
  }
  throw new SolanaError('That slot has no block (it was skipped or is not available yet).');
}

async function transaction(a) {
  if (!isSignature(a.hash)) throw new SolanaError('hash must be a Solana transaction signature (base58).');
  // newer transactions use version 1; ask for it and fall back for nodes that only know version 0
  let t;
  try { t = await rpc('getTransaction', [a.hash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]); } catch (e) {
    if (!/version/i.test(e.message)) throw e;
    t = await rpc('getTransaction', [a.hash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  }
  if (!t) throw new SolanaError('Transaction not found on Solana.');
  const keys = t.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
  const signer = keys[0], m = t.meta || {};
  const solChange = m.preBalances && m.postBalances ? sol(m.postBalances[0] - m.preBalances[0]) : null;
  const tok = {};
  for (const b of m.preTokenBalances || []) tok[b.accountIndex] = { mint: b.mint, owner: b.owner, pre: BigInt(b.uiTokenAmount.amount), post: 0n, dec: b.uiTokenAmount.decimals };
  for (const b of m.postTokenBalances || []) {
    tok[b.accountIndex] = tok[b.accountIndex] || { mint: b.mint, owner: b.owner, pre: 0n, dec: b.uiTokenAmount.decimals };
    tok[b.accountIndex].post = BigInt(b.uiTokenAmount.amount);
  }
  const tokenChanges = Object.values(tok).filter((x) => x.post !== x.pre).slice(0, 20).map((x) => {
    const d = x.post - x.pre, neg = d < 0n, s = (neg ? -d : d).toString().padStart(x.dec + 1, '0');
    return { owner: x.owner, mint: x.mint, change: (neg ? '-' : '+') + ((s.slice(0, s.length - x.dec) + (x.dec ? '.' + s.slice(-x.dec) : '')).replace(/\.?0+$/, '') || '0') };
  });
  return {
    network: 'solana', hash: a.hash, status: m.err ? 'failed' : 'success', error: m.err || undefined, slot: t.slot, timestamp: iso(t.blockTime),
    signer, fee: sol(m.fee || 0), symbol: 'SOL', signerSolChange: solChange, tokenChanges,
    programs: [...new Set((t.transaction.message.instructions || []).map((i) => i.program || i.programId))].slice(0, 10),
    logCount: (m.logMessages || []).length
  };
}

async function account(a) {
  const addr = address(a.address, 'address');
  const r = await rpc('getAccountInfo', [addr, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const v = r && r.value;
  if (!v) return { address: addr, network: 'solana', exists: false, isContract: false, note: 'No account at this address yet (it holds no SOL and no data).' };
  const parsed = v.data && v.data.parsed;
  const kind = v.executable ? 'program' : parsed && parsed.type === 'mint' ? 'token mint' : parsed && parsed.type === 'account' ? 'token account' : v.owner === '11111111111111111111111111111111' ? 'wallet' : 'data account';
  return { address: addr, network: 'solana', exists: true, kind, isContract: v.executable, owner: v.owner, balance: sol(v.lamports), symbol: 'SOL', dataBytes: v.space };
}

async function fees() {
  const r = await rpc('getRecentPrioritizationFees', []);
  const vals = r.map((x) => x.prioritizationFee).sort((x, y) => x - y);
  const pick = (q) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] : 0);
  return { network: 'solana', baseFeePerSignature: '0.000005 SOL', priorityFeeMicroLamportsPerCU: { median: pick(0.5), p75: pick(0.75), p90: pick(0.9) }, note: 'Solana charges 5,000 lamports per signature plus an optional priority fee per compute unit.' };
}

async function safety(a) {
  const mint = address(a.address, 'address');
  const m = await mintInfo(mint);
  const i = m.info, checks = [], ext = {};
  for (const e of m.extensions) ext[e.extension] = e.state || {};
  checks.push(i.mintAuthority
    ? { level: 'warn', title: 'Can create new tokens', detail: `Mint authority is ${i.mintAuthority}. Whoever holds it can increase the supply.` }
    : { level: 'ok', title: 'Minting disabled', detail: 'The mint authority was revoked, so the supply can never grow.' });
  checks.push(i.freezeAuthority
    ? { level: 'warn', title: 'Can freeze holders', detail: `Freeze authority is ${i.freezeAuthority}. It can freeze any holder’s token account so it cannot move tokens.` }
    : { level: 'ok', title: 'Freezing disabled', detail: 'There is no freeze authority, so no one can lock holders’ tokens.' });
  if (m.program === TOKEN_2022) {
    if (ext.permanentDelegate && ext.permanentDelegate.delegate) checks.push({ level: 'warn', title: 'Permanent delegate', detail: `${ext.permanentDelegate.delegate} can move or burn tokens from any holder.` });
    if (ext.transferFeeConfig) checks.push({ level: 'warn', title: 'Transfer fee', detail: 'Every transfer pays a fee set by the token’s fee authority.' });
    if (ext.transferHook && ext.transferHook.programId) checks.push({ level: 'warn', title: 'Transfer hook', detail: `Every transfer runs custom program ${ext.transferHook.programId}, which could block or tax it.` });
    if (ext.defaultAccountState && /frozen/i.test(JSON.stringify(ext.defaultAccountState))) checks.push({ level: 'warn', title: 'New accounts start frozen', detail: 'Holders cannot move tokens until the issuer unfreezes them.' });
    if (ext.nonTransferable) checks.push({ level: 'warn', title: 'Non-transferable', detail: 'This token cannot be transferred between wallets.' });
    if (!Object.keys(ext).some((k) => ['permanentDelegate', 'transferFeeConfig', 'transferHook', 'defaultAccountState', 'nonTransferable'].includes(k))) checks.push({ level: 'ok', title: 'No risky Token-2022 extensions', detail: 'None of the permanent delegate, transfer fee, transfer hook or frozen-by-default extensions are set.' });
  }
  let top = null;
  try {
    const l = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
    const supply = BigInt(i.supply), first = l.value[0] ? BigInt(l.value[0].amount) : 0n;
    const ten = l.value.slice(0, 10).reduce((s, x) => s + BigInt(x.amount), 0n);
    top = { largestAccountPercent: supply ? Number(first * 10000n / supply) / 100 : 0, top10Percent: supply ? Number(ten * 10000n / supply) / 100 : 0 };
    checks.push(top.largestAccountPercent > 50
      ? { level: 'info', title: 'One account holds over half', detail: `The largest token account holds ${top.largestAccountPercent}% of supply. It may be a liquidity pool; check it before relying on that.` }
      : { level: 'ok', title: 'Supply is spread out', detail: `The largest token account holds ${top.largestAccountPercent}%, the top ten ${top.top10Percent}%.` });
  } catch (e) { /* public RPCs sometimes refuse this call; the check simply skips it */ }
  const s = BigInt(i.supply).toString().padStart(i.decimals + 1, '0');
  return {
    address: mint, network: 'solana', explorer: 'https://solscan.io/token/' + mint, isContract: true, checks,
    token: { program: m.program === TOKEN_2022 ? 'Token-2022' : 'SPL Token', decimals: i.decimals, totalSupply: (s.slice(0, s.length - i.decimals) + (i.decimals ? '.' + s.slice(-i.decimals) : '')).replace(/\.?0+$/, '') },
    holders: top || undefined,
    summary: checks.some((c) => c.level === 'warn') ? 'Some powers or unknowns need a closer look.' : 'No red flags found in this quick check.',
    note: 'Reads the token mint and its extensions directly. A quick first look, not an audit.'
  };
}

const HANDLERS = { get_balance: balance, get_token_balance: tokenBalance, get_block: block, get_transaction: transaction, get_code: account, get_gas_price: fees, check_token_safety: safety };

module.exports = { HANDLERS, SolanaError, isAddress, isSignature, rpc };
