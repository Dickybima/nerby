'use strict';
/* Nerby Protocol — swap routing for the Terminal on Robinhood Chain.
   Pons tokens still on their bonding curve trade on the curve directly (no extra fee).
   Everything else — graduated Pons tokens and any other token — is routed by LI.FI,
   whose transaction is checked to go to the official LI.FI contract before it is returned. */
const { callTool } = require('./tools');

const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const LIFI_DIAMOND = '0xb477751b76cf82d00a686a1232f5fcd772414af3';
const NATIVE = '0x0000000000000000000000000000000000000000';
const CHAIN = 4663;
const KNOWN = { eth: NATIVE, nerby: '0xd17d0eabf76f2b3144da726efd341761f4697113' };
const LAUNCHED = 'getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))';

class SwapError extends Error {}

async function tool(name, args) {
  const r = await callTool(name, args);
  if (!r || r.isError) throw new SwapError(r ? r.content[0].text : 'Unavailable');
  return JSON.parse(r.content[0].text);
}
const read = (address, fn, args) => tool('call_contract', { network: 'robinhood', address, function: fn, args: args || [] }).then((x) => x.result);

// symbol → address, from the Pons ranking and GeckoTerminal's token search
let symbols = { at: 0, map: {} };
async function bySymbol(sym) {
  const key = sym.toLowerCase().replace(/^\$/, '');
  if (KNOWN[key]) return [{ address: KNOWN[key], symbol: key.toUpperCase() }];
  if (Date.now() - symbols.at > 120000) {
    try {
      const d = await tool('get_top_pons_tokens', { limit: 50 });
      const map = {};
      for (const t of d.tokens) (map[t.symbol.toLowerCase()] = map[t.symbol.toLowerCase()] || []).push({ address: t.address, symbol: t.symbol, name: t.name, volume: t.volume24h });
      symbols = { at: Date.now(), map };
    } catch (e) { /* fall through to search */ }
  }
  if (symbols.map[key]) return symbols.map[key];
  try {
    const r = await fetch('https://api.geckoterminal.com/api/v2/search/pools?network=robinhood&query=' + encodeURIComponent(key), { signal: AbortSignal.timeout(10000) });
    const j = await r.json(), seen = {}, out = [];
    for (const p of j.data || []) {
      const id = p.relationships.base_token.data.id.split('_')[1], name = p.attributes.name.split(' / ')[0];
      if (name.toLowerCase() !== key || seen[id]) continue;
      seen[id] = 1; out.push({ address: id.toLowerCase(), symbol: name, volume: Number(p.attributes.volume_usd.h24 || 0) });
    }
    return out.sort((a, b) => b.volume - a.volume);
  } catch (e) { return []; }
}

async function token(q) {
  if (!q) throw new SwapError('Name a token, for example nerby or a 0x address.');
  let address = q, matches = null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(q)) {
    matches = await bySymbol(q);
    if (!matches.length) throw new SwapError(`No token called "${q}" was found on Robinhood Chain. Use its 0x address instead.`);
    address = matches[0].address;
  }
  address = address.toLowerCase();
  if (address === NATIVE) return { address: NATIVE, symbol: 'ETH', decimals: 18, native: true };
  const [symbol, decimals, launch] = await Promise.all([
    read(address, 'symbol() view returns (string)').catch(() => null),
    read(address, 'decimals() view returns (uint8)').catch(() => null),
    read(FACTORY, LAUNCHED, [address]).catch(() => null)
  ]);
  if (decimals === null) throw new SwapError(`${address} is not an ERC-20 token.`);
  const out = { address, symbol: symbol || address.slice(0, 8), decimals: Number(decimals) };
  if (launch && launch.exists) {
    out.pons = { curve: launch.curve.toLowerCase(), pair: launch.pairToken.toLowerCase(), phase: Number(launch.phase), creatorTaxBps: Number(launch.creatorTaxBps) };
    out.onCurve = out.pons.phase === 0 && out.pons.pair === NATIVE;
  }
  if (matches && matches.length > 1) out.alsoNamed = matches.slice(1, 4).map((m) => m.address);
  return out;
}

async function lifiQuote(a) {
  const u = new URL('https://li.quest/v1/quote');
  const params = { fromChain: CHAIN, toChain: CHAIN, fromToken: a.from, toToken: a.to, fromAmount: a.amount, fromAddress: a.address.toLowerCase(), slippage: a.slippage, integrator: 'nerby' };
  for (const k in params) u.searchParams.set(k, params[k]);
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  if (!r.ok || !j.transactionRequest) throw new SwapError('No route found for this swap' + (j.message ? ': ' + j.message : '') + '.');
  const t = j.transactionRequest, e = j.estimate;
  // never hand the wallet a transaction to anything but the official LI.FI contract
  if (String(t.to).toLowerCase() !== LIFI_DIAMOND) throw new SwapError('The route came back pointing at an unknown contract, so it was rejected.');
  if (e.approvalAddress && String(e.approvalAddress).toLowerCase() !== LIFI_DIAMOND && a.from !== NATIVE) throw new SwapError('The route asked for an approval to an unknown contract, so it was rejected.');
  return {
    route: 'lifi', via: j.toolDetails ? j.toolDetails.name : j.tool, toAmount: e.toAmount, toAmountMin: e.toAmountMin,
    fromUsd: e.fromAmountUSD, toUsd: e.toAmountUSD,
    fees: (e.feeCosts || []).map((f) => ({ name: f.name, percent: Number(f.percentage) * 100 })),
    approval: a.from === NATIVE ? null : LIFI_DIAMOND,
    tx: { to: LIFI_DIAMOND, data: t.data, value: t.value || '0x0' }
  };
}

module.exports = { token, lifiQuote, SwapError, NATIVE, LIFI_DIAMOND };
