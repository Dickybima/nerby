'use strict';
/* Nerby Protocol — chain tools exposed over MCP. Read-only: nothing here holds or uses a private key. */
const { encodeFunctionData, decodeFunctionResult, encodeDeployData, getContractAddress, parseAbiItem, formatUnits, isAddress, toFunctionSelector } = require('viem');
const { compile, erc20Source, encodeRecipe, CompileError } = require('./compiler');
const { market, MarketError } = require('./market');
const solana = require('./solana');
const { topPons } = require('./pons');

// Public RPC endpoints. Override any of them with an env var, e.g. RPC_ETHEREUM=https://…
const NETWORKS = {
  robinhood: { name: 'Robinhood Chain', chainId: 4663, symbol: 'ETH', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com', blockscout: 'https://robinhoodchain.blockscout.com' },
  ethereum: { name: 'Ethereum', chainId: 1, symbol: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io', blockscout: 'https://eth.blockscout.com' },
  base: { name: 'Base', chainId: 8453, symbol: 'ETH', rpc: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org', blockscout: 'https://base.blockscout.com' },
  arbitrum: { name: 'Arbitrum One', chainId: 42161, symbol: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com', explorer: 'https://arbiscan.io', blockscout: 'https://arbitrum.blockscout.com' },
  optimism: { name: 'OP Mainnet', chainId: 10, symbol: 'ETH', rpc: 'https://optimism-rpc.publicnode.com', explorer: 'https://optimistic.etherscan.io', blockscout: 'https://optimism.blockscout.com' },
  polygon: { name: 'Polygon', chainId: 137, symbol: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com', explorer: 'https://polygonscan.com', blockscout: 'https://polygon.blockscout.com' },
  bsc: { name: 'BNB Smart Chain', chainId: 56, symbol: 'BNB', rpc: 'https://bsc-rpc.publicnode.com', explorer: 'https://bscscan.com' },
  avalanche: { name: 'Avalanche C-Chain', chainId: 43114, symbol: 'AVAX', rpc: 'https://avalanche-c-chain-rpc.publicnode.com', explorer: 'https://snowtrace.io' },
  linea: { name: 'Linea', chainId: 59144, symbol: 'ETH', rpc: 'https://linea-rpc.publicnode.com', explorer: 'https://lineascan.build' },
  scroll: { name: 'Scroll', chainId: 534352, symbol: 'ETH', rpc: 'https://scroll-rpc.publicnode.com', explorer: 'https://scrollscan.com' },
  gnosis: { name: 'Gnosis', chainId: 100, symbol: 'XDAI', rpc: 'https://gnosis-rpc.publicnode.com', explorer: 'https://gnosisscan.io' },
  elysium: { name: 'Elysium', chainId: 1339, symbol: 'ELY', rpc: 'https://rpc.elysiumchain.tech', explorer: 'https://elysiumscan.com', blockscout: 'https://elysiumscan.com' },
  solana: { name: 'Solana', type: 'solana', chainId: null, symbol: 'SOL', rpc: 'https://solana-rpc.publicnode.com', explorer: 'https://solscan.io' }
};
const NETWORK_IDS = Object.keys(NETWORKS);

class ToolError extends Error {}

function net(id) {
  const n = NETWORKS[id];
  if (!n) throw new ToolError(`Unknown network "${id}". Use one of: ${NETWORK_IDS.join(', ')}.`);
  return n;
}

async function rpc(network, method, params, attempt) {
  const n = net(network);
  const url = process.env['RPC_' + network.toUpperCase()] || n.rpc;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    throw new ToolError(`Could not reach the ${n.name} RPC (${e.name === 'TimeoutError' ? 'timed out' : e.message}).`);
  }
  // public RPCs rate-limit bursts: wait a moment and try again before giving up
  if (res.status === 429 && (attempt || 0) < 3) {
    await new Promise((ok) => setTimeout(ok, 400 * ((attempt || 0) + 1) + Math.random() * 300));
    return rpc(network, method, params, (attempt || 0) + 1);
  }
  if (!res.ok) throw new ToolError(`${n.name} RPC answered HTTP ${res.status}.`);
  const body = await res.json();
  if (body.error) {
    const err = new ToolError(body.error.message || 'RPC error');
    err.rpc = body.error;
    throw err;
  }
  return body.result;
}

const big = (hex) => BigInt(hex);
const num = (hex) => Number(BigInt(hex));
const toHex = (v) => '0x' + BigInt(v).toString(16);

function address(v, label) {
  if (typeof v !== 'string' || !isAddress(v, { strict: false })) throw new ToolError(`${label} must be a 0x address (40 hex characters).`);
  return v;
}
function hash(v, label) {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new ToolError(`${label} must be a 0x hash (64 hex characters).`);
  return v;
}
function hexData(v, label) {
  if (v === undefined || v === null || v === '') return '0x';
  if (typeof v !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(v)) throw new ToolError(`${label} must be 0x-prefixed hex.`);
  return v;
}
function blockTag(v) {
  if (v === undefined || v === null || v === '' || v === 'latest') return 'latest';
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return toHex(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return toHex(v);
  if (typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)) return v;
  throw new ToolError('block must be a block number or "latest".');
}

// JSON arguments arrive as strings/numbers; viem wants bigint for integer types.
function coerce(type, value) {
  if (type.endsWith(']')) {
    if (!Array.isArray(value)) throw new ToolError(`Expected an array for ${type}.`);
    const inner = type.slice(0, type.lastIndexOf('['));
    return value.map((v) => coerce(inner, v));
  }
  if (/^u?int/.test(type)) {
    try { return BigInt(value); } catch (e) { throw new ToolError(`"${value}" is not a valid ${type}.`); }
  }
  return value;
}

function parseFn(signature) {
  let item;
  try {
    item = parseAbiItem(/^\s*function\s/.test(signature) ? signature : 'function ' + signature);
  } catch (e) {
    throw new ToolError('Could not parse the function signature. Example: "balanceOf(address) view returns (uint256)".');
  }
  if (item.type !== 'function') throw new ToolError('The signature must describe a function.');
  return item;
}

async function readContract(network, to, signature, args, block) {
  const item = parseFn(signature);
  const list = args || [];
  if (list.length !== item.inputs.length) throw new ToolError(`${item.name} takes ${item.inputs.length} argument(s), got ${list.length}.`);
  let data;
  try {
    data = encodeFunctionData({ abi: [item], functionName: item.name, args: list.map((a, i) => coerce(item.inputs[i].type, a)) });
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError('Could not encode the arguments: ' + (e.shortMessage || e.message));
  }
  const raw = await rpc(network, 'eth_call', [{ to, data }, block || 'latest']);
  if (!item.outputs.length) return { raw };
  if (raw === '0x') throw new ToolError('The call returned no data — the address may not be a contract or may not have this function.');
  try {
    return { result: decodeFunctionResult({ abi: [item], functionName: item.name, data: raw }), raw };
  } catch (e) {
    throw new ToolError('Could not decode the result with the given return types.');
  }
}


// ---------- verified source ----------
async function getJson(url) {
  let res;
  try { res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); } catch (e) { return null; }
  if (!res.ok) return null;
  try { return await res.json(); } catch (e) { return null; }
}

async function verifiedSource(network, addr) {
  const n = net(network);
  const s = await getJson(`https://sourcify.dev/server/v2/contract/${n.chainId}/${addr}?fields=abi,sources,compilation,proxyResolution`);
  if (s && s.match && s.sources) {
    const impl = s.proxyResolution && s.proxyResolution.implementations;
    return {
      via: 'Sourcify', match: s.match, name: s.compilation && s.compilation.name, compiler: s.compilation && s.compilation.compilerVersion, abi: s.abi || [],
      files: Object.keys(s.sources).map((path) => ({ path, content: s.sources[path].content || '' })),
      implementations: impl && impl.length ? impl.map((i) => i.address) : undefined
    };
  }
  if (n.blockscout) {
    const b = await getJson(`${n.blockscout}/api/v2/smart-contracts/${addr}`);
    if (b && b.is_verified && b.source_code) {
      const files = [{ path: b.file_path || (b.name || 'Contract') + '.sol', content: b.source_code }]
        .concat((b.additional_sources || []).map((f) => ({ path: f.file_path, content: f.source_code })));
      const impl = (b.implementations || []).map((i) => i.address_hash || i.address).filter(Boolean);
      return { via: 'Blockscout', match: b.is_partially_verified ? 'partial' : 'exact', name: b.name, compiler: b.compiler_version, abi: b.abi || [], files, implementations: impl.length ? impl : undefined };
    }
  }
  return null;
}

const abiSig = (i) => `${i.name}(${(i.inputs || []).map((x) => x.type).join(',')})` +
  (i.type === 'function' ? ` ${i.stateMutability || ''}` + ((i.outputs || []).length ? ` returns (${i.outputs.map((x) => x.type).join(',')})` : '') : '');

// ---------- token safety ----------
// Function signatures whose presence in a contract's dispatcher gives someone extra power over holders.
const RISKY = [
  { key: 'mint', label: 'Can create new tokens', sigs: ['mint(address,uint256)', 'mint(uint256)', 'mintTo(address,uint256)'] },
  { key: 'pause', label: 'Can pause transfers', sigs: ['pause()', 'setPaused(bool)', 'setTradingEnabled(bool)', 'enableTrading()', 'setTrading(bool)'] },
  { key: 'blacklist', label: 'Can block addresses', sigs: ['blacklist(address)', 'addToBlacklist(address)', 'addBlackList(address)', 'setBlacklist(address,bool)', 'setBots(address[])', 'blockBots(address[])', 'setIsBlacklisted(address,bool)'] },
  { key: 'fees', label: 'Can change trading fees', sigs: ['setFee(uint256)', 'setFees(uint256,uint256)', 'setTaxFee(uint256)', 'setBuyFee(uint256)', 'setSellFee(uint256)', 'setTaxes(uint256,uint256)', 'updateFees(uint256,uint256)', 'setBuyTax(uint256)', 'setSellTax(uint256)'] },
  { key: 'limits', label: 'Can change transaction limits', sigs: ['setMaxTxAmount(uint256)', 'setMaxWalletSize(uint256)', 'setMaxWallet(uint256)', 'setMaxTx(uint256)', 'removeLimits()'] },
  { key: 'upgrade', label: 'Code can be replaced (upgradeable)', sigs: ['upgradeTo(address)', 'upgradeToAndCall(address,bytes)'] }
].map((r) => Object.assign(r, { sels: r.sigs.map((g) => toFunctionSelector('function ' + g).slice(2)) }));
const EIP1967_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

function selectorsIn(code) {
  const hex = code.toLowerCase();
  return RISKY.map((r) => ({ key: r.key, label: r.label, found: r.sigs.filter((g, i) => hex.includes('63' + r.sels[i])) }));
}

// ---------- deployment ----------
function buildSource(a) {
  if (a.template !== undefined && a.template !== null && a.template !== '') {
    if (a.template !== 'erc20') throw new ToolError('Unknown template. Available: "erc20".');
    let t;
    try { t = erc20Source(a.params); } catch (e) { if (e instanceof CompileError) throw new ToolError(e.message); throw e; }
    return { source: t.source, contractName: t.contractName, recipe: { t: 'erc20', p: t.params } };
  }
  if (!a.source) throw new ToolError('Give either template: "erc20" with params, or source with your own Solidity code.');
  return { source: String(a.source), contractName: a.contractName || undefined, recipe: { t: 'source', s: String(a.source), c: a.contractName || undefined } };
}

function compiled(source, contractName) {
  try { return compile(source, contractName); } catch (e) {
    if (e instanceof CompileError) throw new ToolError(e.message);
    throw e;
  }
}

const sourceProps = {
  template: { type: 'string', enum: ['erc20'], description: 'Built-in template. "erc20" is a fixed-supply token on OpenZeppelin contracts.' },
  params: {
    type: 'object', description: 'Template parameters. erc20: name, symbol, supply (whole tokens, as a string), burnable (boolean), mintable (boolean, owner can mint more).',
    properties: { name: { type: 'string' }, symbol: { type: 'string' }, supply: { type: 'string' }, burnable: { type: 'boolean' }, mintable: { type: 'boolean' } }
  },
  source: { type: 'string', description: 'Your own Solidity source as a single file (use instead of template). Imports from @openzeppelin/contracts are available; pragma must allow Solidity 0.8.38.' },
  contractName: { type: 'string', description: 'Which contract to deploy when the source defines more than one.' }
};

const netProp = { type: 'string', enum: NETWORK_IDS, description: 'Network to query.' };
const addrProp = (d) => ({ type: 'string', description: d + ' (0x address; base58 on Solana).' });
const blockProp = { type: ['string', 'integer'], description: 'Block number, or "latest" (default).' };

const TOOLS = [
  {
    name: 'list_networks',
    description: 'List the networks Nerby Protocol can reach, with chain IDs, native currency and block explorer.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => NETWORK_IDS.map((id) => ({ id, name: NETWORKS[id].name, type: NETWORKS[id].type || 'evm', chainId: NETWORKS[id].chainId, nativeCurrency: NETWORKS[id].symbol, explorer: NETWORKS[id].explorer, publicRpc: NETWORKS[id].rpc }))
  },
  {
    name: 'get_balance',
    description: 'Get the native currency balance (ETH, POL, BNB…) of an address.',
    inputSchema: { type: 'object', properties: { network: netProp, address: addrProp('Account to check'), block: blockProp }, required: ['network', 'address'] },
    run: async (a) => {
      const wei = big(await rpc(a.network, 'eth_getBalance', [address(a.address, 'address'), blockTag(a.block)]));
      return { address: a.address, network: a.network, balance: formatUnits(wei, 18), symbol: net(a.network).symbol, wei };
    }
  },
  {
    name: 'get_token_balance',
    description: 'Get the ERC-20 token balance of an address, with the token symbol and decimals.',
    inputSchema: { type: 'object', properties: { network: netProp, token: addrProp('ERC-20 token contract'), address: addrProp('Holder to check'), block: blockProp }, required: ['network', 'token', 'address'] },
    run: async (a) => {
      const token = address(a.token, 'token'), holder = address(a.address, 'address'), block = blockTag(a.block);
      const [bal, dec, sym] = await Promise.all([
        readContract(a.network, token, 'balanceOf(address) view returns (uint256)', [holder], block),
        readContract(a.network, token, 'decimals() view returns (uint8)', [], block).catch(() => ({ result: 18, assumed: true })),
        readContract(a.network, token, 'symbol() view returns (string)', [], block).catch(() => ({ result: null }))
      ]);
      const out = { token, holder, network: a.network, balance: formatUnits(bal.result, Number(dec.result)), symbol: sym.result, decimals: Number(dec.result), raw: bal.result };
      if (dec.assumed) out.note = 'The token did not report decimals; 18 was assumed.';
      return out;
    }
  },
  {
    name: 'get_block',
    description: 'Get a block header: number, hash, timestamp, gas used, base fee and transaction count.',
    inputSchema: { type: 'object', properties: { network: netProp, block: blockProp }, required: ['network'] },
    run: async (a) => {
      const b = await rpc(a.network, 'eth_getBlockByNumber', [blockTag(a.block), false]);
      if (!b) throw new ToolError('Block not found.');
      return {
        network: a.network, number: num(b.number), hash: b.hash, parentHash: b.parentHash,
        timestamp: new Date(num(b.timestamp) * 1000).toISOString(), miner: b.miner,
        gasUsed: big(b.gasUsed), gasLimit: big(b.gasLimit),
        baseFeeGwei: b.baseFeePerGas ? formatUnits(big(b.baseFeePerGas), 9) : null,
        transactionCount: b.transactions.length
      };
    }
  },
  {
    name: 'get_transaction',
    description: 'Get a transaction and its receipt by hash: sender, recipient, value, status, gas used, fee and emitted logs.',
    inputSchema: { type: 'object', properties: { network: netProp, hash: { type: 'string', description: 'Transaction hash.' } }, required: ['network', 'hash'] },
    run: async (a) => {
      const h = hash(a.hash, 'hash');
      const [tx, rc] = await Promise.all([rpc(a.network, 'eth_getTransactionByHash', [h]), rpc(a.network, 'eth_getTransactionReceipt', [h])]);
      if (!tx) throw new ToolError('Transaction not found on ' + net(a.network).name + '.');
      const out = {
        network: a.network, hash: tx.hash, from: tx.from, to: tx.to, value: formatUnits(big(tx.value), 18), symbol: net(a.network).symbol,
        nonce: num(tx.nonce), input: tx.input.length > 1034 ? tx.input.slice(0, 1034) + '…' : tx.input,
        status: rc ? (rc.status === '0x1' ? 'success' : 'reverted') : 'pending'
      };
      if (rc) {
        out.blockNumber = num(rc.blockNumber);
        out.gasUsed = big(rc.gasUsed);
        if (rc.effectiveGasPrice) out.fee = formatUnits(big(rc.gasUsed) * big(rc.effectiveGasPrice), 18);
        out.contractCreated = rc.contractAddress || null;
        out.logCount = rc.logs.length;
        out.logs = rc.logs.slice(0, 25).map((l) => ({ address: l.address, topics: l.topics, data: l.data }));
      }
      return out;
    }
  },
  {
    name: 'get_logs',
    description: 'Get event logs emitted by a contract over a block range (at most 2,000 blocks; defaults to the latest 500). Returns up to 50 logs.',
    inputSchema: {
      type: 'object',
      properties: {
        network: netProp, address: addrProp('Contract that emitted the logs'),
        fromBlock: { type: 'integer', description: 'First block (default: latest − 500).' },
        toBlock: { type: 'integer', description: 'Last block (default: latest).' },
        topics: { type: 'array', items: { type: ['string', 'null'] }, description: 'Optional topic filters; topic 0 is the event signature hash.' }
      },
      required: ['network', 'address']
    },
    run: async (a) => {
      const latest = num(await rpc(a.network, 'eth_blockNumber', []));
      const to = a.toBlock === undefined ? latest : Number(a.toBlock);
      const from = a.fromBlock === undefined ? Math.max(0, to - 500) : Number(a.fromBlock);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) throw new ToolError('fromBlock and toBlock must be block numbers with fromBlock ≤ toBlock.');
      if (to - from > 2000) throw new ToolError('The range is limited to 2,000 blocks per call.');
      const filter = { address: address(a.address, 'address'), fromBlock: toHex(from), toBlock: toHex(to) };
      if (a.topics) filter.topics = a.topics;
      const logs = await rpc(a.network, 'eth_getLogs', [filter]);
      return {
        network: a.network, fromBlock: from, toBlock: to, total: logs.length, truncated: logs.length > 50,
        logs: logs.slice(0, 50).map((l) => ({ blockNumber: num(l.blockNumber), transactionHash: l.transactionHash, topics: l.topics, data: l.data }))
      };
    }
  },
  {
    name: 'get_code',
    description: 'Check whether an address is a contract and return its bytecode size (and the bytecode itself when small).',
    inputSchema: { type: 'object', properties: { network: netProp, address: addrProp('Address to inspect'), block: blockProp }, required: ['network', 'address'] },
    run: async (a) => {
      const code = await rpc(a.network, 'eth_getCode', [address(a.address, 'address'), blockTag(a.block)]);
      const bytes = (code.length - 2) / 2;
      return { address: a.address, network: a.network, isContract: bytes > 0, bytecodeBytes: bytes, bytecode: bytes <= 2048 ? code : code.slice(0, 4098) + '…' };
    }
  },
  {
    name: 'read_storage',
    description: 'Read a raw 32-byte storage slot of a contract.',
    inputSchema: { type: 'object', properties: { network: netProp, address: addrProp('Contract'), slot: { type: ['string', 'integer'], description: 'Slot index (number or 0x hex).' }, block: blockProp }, required: ['network', 'address', 'slot'] },
    run: async (a) => {
      let slot;
      try { slot = toHex(a.slot); } catch (e) { throw new ToolError('slot must be a number or 0x hex.'); }
      const value = await rpc(a.network, 'eth_getStorageAt', [address(a.address, 'address'), slot, blockTag(a.block)]);
      return { address: a.address, network: a.network, slot, value };
    }
  },
  {
    name: 'call_contract',
    description: 'Call a read-only contract function and decode the result. Give the function as a Solidity signature, e.g. "totalSupply() view returns (uint256)" or "ownerOf(uint256) view returns (address)".',
    inputSchema: {
      type: 'object',
      properties: {
        network: netProp, address: addrProp('Contract to call'),
        function: { type: 'string', description: 'Solidity function signature including return types.' },
        args: { type: 'array', description: 'Arguments in order. Pass integers as strings to keep precision.', items: {} },
        block: blockProp
      },
      required: ['network', 'address', 'function']
    },
    run: async (a) => {
      const r = await readContract(a.network, address(a.address, 'address'), String(a.function), a.args, blockTag(a.block));
      return { address: a.address, network: a.network, function: a.function, result: r.result === undefined ? null : r.result, raw: r.raw };
    }
  },
  {
    name: 'get_gas_price',
    description: 'Get the current gas price and priority fee for a network, in gwei.',
    inputSchema: { type: 'object', properties: { network: netProp }, required: ['network'] },
    run: async (a) => {
      const [gp, tip] = await Promise.all([rpc(a.network, 'eth_gasPrice', []), rpc(a.network, 'eth_maxPriorityFeePerGas', []).catch(() => null)]);
      return { network: a.network, gasPriceGwei: formatUnits(big(gp), 9), priorityFeeGwei: tip ? formatUnits(big(tip), 9) : null };
    }
  },
  {
    name: 'get_contract_source',
    description: 'Look up the verified source code of a contract (Sourcify, then Blockscout). part "overview" (default) returns the contract name, compiler, file list and function signatures; "abi" returns the full ABI; "source" returns the file contents.',
    inputSchema: {
      type: 'object',
      properties: {
        network: netProp, address: addrProp('Contract to look up'),
        part: { type: 'string', enum: ['overview', 'abi', 'source'], description: 'What to return (default "overview").' },
        file: { type: 'string', description: 'With part "source": return only this file path.' }
      },
      required: ['network', 'address']
    },
    run: async (a) => {
      const addr = address(a.address, 'address'), n = net(a.network);
      const v = await verifiedSource(a.network, addr);
      const explorer = `${n.explorer}/address/${addr}`;
      if (!v) return { address: addr, network: a.network, verified: false, blockscout: n.blockscout || null, note: 'No verified source was found on Sourcify' + (n.blockscout ? ' or Blockscout' : '') + '. The contract may be unverified, or verified only on another explorer.', explorer };
      const head = { address: addr, network: a.network, verified: true, via: v.via, match: v.match, name: v.name, compiler: v.compiler, explorer };
      if (v.implementations) { head.proxyImplementations = v.implementations; head.note = 'This is a proxy. Look up an implementation address to see the logic.'; }
      const part = a.part || 'overview';
      if (part === 'abi') return Object.assign(head, { abi: v.abi });
      if (part === 'source') {
        let files = v.files;
        if (a.file) { files = files.filter((f) => f.path === a.file); if (!files.length) throw new ToolError('No such file. Available: ' + v.files.map((f) => f.path).join(', ')); }
        let left = 60000; const out = [];
        for (const f of files) {
          if (left <= 0) { out.push({ path: f.path, omitted: true, characters: f.content.length }); continue; }
          out.push(f.content.length > left ? { path: f.path, content: f.content.slice(0, left), truncated: true, characters: f.content.length } : { path: f.path, content: f.content });
          left -= f.content.length;
        }
        return Object.assign(head, { files: out });
      }
      return Object.assign(head, {
        files: v.files.map((f) => ({ path: f.path, characters: f.content.length })),
        functions: v.abi.filter((i) => i.type === 'function').map(abiSig),
        events: v.abi.filter((i) => i.type === 'event').map(abiSig)
      });
    }
  },
  {
    name: 'get_token_market',
    description: 'Market data for a token from its DEX pools (via GeckoTerminal): price in USD, fully diluted value, liquidity, 24h volume, price change and buy/sell counts per pool. Returns listed: false when no pool is found.',
    inputSchema: { type: 'object', properties: { network: netProp, token: addrProp('Token contract') }, required: ['network', 'token'] },
    run: async (a) => {
      net(a.network);
      const tok = a.network === 'solana' ? (solana.isAddress(a.token) ? a.token : (() => { throw new ToolError('token must be a Solana mint address.'); })()) : address(a.token, 'token');
      try { return await market(a.network, tok, false); } catch (e) {
        if (e instanceof MarketError) throw new ToolError(e.message);
        throw e;
      }
    }
  },
  {
    name: 'get_top_pons_tokens',
    description: 'Top tokens launched on Pons (Robinhood Chain) ranked by 24h trading volume across the Pons curves, graduated Pons pools and older Pons pools. Each entry has price, 24h change, FDV, liquidity, buys and sells, stage (curve, graduated or pons) and, for tokens still on a curve, how close they are to graduating.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'How many tokens to return (default 10, max 50).' }, minFdvUsd: { type: 'number', description: 'Only tokens with at least this fully diluted value in USD.' } } },
    run: async (a) => {
      const d = await topPons(ponsCurveReader).catch((e) => { throw new ToolError('Pons data is not available right now (' + e.message + ').'); });
      const min = Number(a.minFdvUsd) || 0, limit = Math.min(50, Math.max(1, Number(a.limit) || 10));
      return { updatedAt: d.updatedAt, source: d.source, tokens: d.tokens.filter((t) => (t.fdvUsd || 0) >= min).slice(0, limit).map(({ pools, curve, ...t }) => t) };
    }
  },
  {
    name: 'check_token_safety',
    description: 'Quick safety check of a token or contract: whether the deployer still has powers such as minting, pausing, blocking addresses, changing fees or replacing the code; whether ownership was renounced; whether the source is verified; and how much supply is burned. Reads the bytecode and storage directly. A heuristic first look, not an audit.',
    inputSchema: { type: 'object', properties: { network: netProp, address: addrProp('Token or contract to check') }, required: ['network', 'address'] },
    run: async (a) => {
      const n = net(a.network), addr = address(a.address, 'address');
      let code = await rpc(a.network, 'eth_getCode', [addr, 'latest']);
      if (code === '0x' || /^0xef0100/i.test(code)) return { address: addr, network: a.network, isContract: false, note: 'This address is a wallet, not a contract, so there is nothing to check.' };
      const implSlot = await rpc(a.network, 'eth_getStorageAt', [addr, EIP1967_IMPL, 'latest']).catch(() => '0x0');
      const impl = big(implSlot) ? '0x' + implSlot.slice(-40) : null;
      if (impl) code += (await rpc(a.network, 'eth_getCode', [impl, 'latest']).catch(() => '')).slice(2);
      const read = (fn, args) => readContract(a.network, addr, fn, args || [], 'latest').then((r) => r.result).catch(() => undefined);
      const [owner, name, symbol, decimals, supply, dead, zero, source] = await Promise.all([
        read('owner() view returns (address)'), read('name() view returns (string)'), read('symbol() view returns (string)'), read('decimals() view returns (uint8)'),
        read('totalSupply() view returns (uint256)'), read('balanceOf(address) view returns (uint256)', ['0x000000000000000000000000000000000000dEaD']),
        read('balanceOf(address) view returns (uint256)', ['0x0000000000000000000000000000000000000000']),
        verifiedSource(a.network, addr).catch(() => null)
      ]);
      const renounced = owner !== undefined && /^0x0{40}$/i.test(owner);
      const hasOwner = owner !== undefined && !renounced;
      const powers = selectorsIn(code).filter((p) => p.found.length);
      const checks = [];
      checks.push(hasOwner
        ? { level: powers.length ? 'warn' : 'info', title: 'Has an owner', detail: `Owner is ${owner}.` + (powers.length ? ' The owner may be able to use the powers listed below.' : '') }
        : { level: 'ok', title: renounced ? 'Ownership renounced' : 'No owner function', detail: renounced ? 'owner() returns the zero address, so no one holds owner rights.' : 'The contract has no owner() function.' });
      for (const p of powers) checks.push({ level: hasOwner || p.key === 'upgrade' ? 'warn' : 'info', title: p.label, detail: 'Found ' + p.found.join(', ') + '.' + (hasOwner ? '' : ' Without an owner these may be locked or limited to other roles; check the source.') });
      if (impl) checks.push({ level: 'warn', title: 'Proxy contract', detail: `The logic lives at ${impl} and can be swapped by whoever controls the proxy.` });
      if (!powers.length && !impl) checks.push({ level: 'ok', title: 'No common admin functions', detail: 'None of the usual mint, pause, blacklist, fee, limit or upgrade functions were found in the bytecode.' });
      checks.push(source ? { level: 'ok', title: 'Source verified', detail: `Verified on ${source.via}${source.name ? ' as ' + source.name : ''}.` } : { level: 'warn', title: 'Source not verified', detail: 'The code cannot be read on Sourcify or Blockscout, so these checks rely on the bytecode alone.' });
      const out = { address: addr, network: a.network, explorer: `${n.explorer}/address/${addr}`, blockscout: n.blockscout || null, isContract: true, checks };
      if (supply !== undefined) {
        const burned = (dead || 0n) + (zero || 0n), dec = Number(decimals === undefined ? 18 : decimals);
        Object.assign(out, { token: { name, symbol, decimals: dec, totalSupply: formatUnits(supply, dec), burned: formatUnits(burned, dec), burnedPercent: supply ? Number(burned * 100000n / supply) / 1000 : 0 } });
      }
      out.summary = checks.filter((c) => c.level === 'warn').length ? 'Some powers or unknowns need a closer look.' : 'No red flags found in this quick check.';
      out.note = 'Heuristic check based on function signatures in the bytecode. It can miss custom admin functions and is not an audit.';
      return out;
    }
  },
  {
    name: 'compile_contract',
    description: 'Compile a Solidity contract (or the built-in erc20 template) and report errors, warnings, the ABI and bytecode size. Nothing is deployed. Use this to check a contract before prepare_deployment.',
    inputSchema: { type: 'object', properties: sourceProps },
    run: async (a) => {
      const b = buildSource(a), c = compiled(b.source, b.contractName);
      const out = { contract: c.name, compiler: c.compiler, openzeppelin: c.openzeppelin, bytecodeBytes: (c.bytecode.length - 2) / 2, constructorInputs: (c.abi.find((i) => i.type === 'constructor') || { inputs: [] }).inputs.map((i) => `${i.type} ${i.name}`), functions: c.abi.filter((i) => i.type === 'function').map(abiSig), warnings: c.warnings };
      if (out.bytecodeBytes > 24576) out.note = 'The bytecode is over the 24,576-byte contract size limit and would fail to deploy.';
      if (a.template) out.source = b.source;
      return out;
    }
  },
  {
    name: 'prepare_deployment',
    description: 'Compile a contract and prepare its deployment on a network: gas and fee estimate, the address it would get, and a link to the Nerby Protocol deploy page where the user reviews it and signs with their own wallet. Nothing is signed or sent by this tool. Always give the user the deployUrl and tell them the fee and what the contract does.',
    inputSchema: {
      type: 'object',
      properties: Object.assign({ network: netProp, from: addrProp('Wallet that will deploy and pay the gas') }, sourceProps, {
        constructorArgs: { type: 'array', items: {}, description: 'Constructor arguments in order, for your own source. Pass integers as strings.' },
        includeData: { type: 'boolean', description: 'Also return the full deployment calldata (large). Default false.' }
      }),
      required: ['network', 'from']
    },
    run: async (a) => {
      const n = net(a.network), from = address(a.from, 'from');
      const b = buildSource(a), c = compiled(b.source, b.contractName);
      const ctor = c.abi.find((i) => i.type === 'constructor') || { inputs: [] };
      const args = a.constructorArgs || [];
      if (args.length !== ctor.inputs.length) throw new ToolError(`The constructor takes ${ctor.inputs.length} argument(s) (${ctor.inputs.map((i) => i.type + ' ' + i.name).join(', ') || 'none'}), got ${args.length}.`);
      let data;
      try { data = encodeDeployData({ abi: c.abi, bytecode: c.bytecode, args: args.map((v, i) => coerce(ctor.inputs[i].type, v)) }); } catch (e) {
        if (e instanceof ToolError) throw e;
        throw new ToolError('Could not encode the constructor arguments: ' + (e.shortMessage || e.message));
      }
      const [nonce, gasPrice, balance] = await Promise.all([rpc(a.network, 'eth_getTransactionCount', [from, 'pending']), rpc(a.network, 'eth_gasPrice', []), rpc(a.network, 'eth_getBalance', [from, 'latest'])]);
      const out = { network: a.network, chainId: n.chainId, contract: c.name, from, bytecodeBytes: (data.length - 2) / 2, wouldSucceed: true };
      let gas = null;
      try { gas = big(await rpc(a.network, 'eth_estimateGas', [{ from, data }])); } catch (e) {
        if (!e.rpc) throw e;
        out.wouldSucceed = false; out.revertReason = e.message;
      }
      if (gas !== null) {
        const fee = gas * big(gasPrice);
        out.gasEstimate = gas; out.gasPriceGwei = formatUnits(big(gasPrice), 9);
        out.estimatedFee = formatUnits(fee, 18) + ' ' + n.symbol;
        out.balance = formatUnits(big(balance), 18) + ' ' + n.symbol;
        out.enoughBalance = big(balance) >= fee;
        out.predictedAddress = getContractAddress({ from, nonce: big(nonce) });
        out.unsignedTransaction = { chainId: n.chainId, from, to: null, value: '0x0', nonce: num(nonce), gas: toHex(gas * 12n / 10n), data: a.includeData ? data : `(${out.bytecodeBytes} bytes; pass includeData to get it)` };
      }
      if (c.warnings.length) out.warnings = c.warnings;
      if (b.recipe.t === 'erc20') out.source = b.source;
      const link = encodeRecipe(Object.assign({ v: 1, n: a.network, a: args.length ? args.map(String) : undefined }, b.recipe));
      if (link.length <= 6000) out.deployUrl = link;
      else out.deployPage = 'https://www.nerbyprotocol.xyz/deploy.html (the source is too long for a link: ask the user to paste it into the Custom contract box there)';
      out.note = out.wouldSucceed
        ? 'Nothing was sent. The user deploys by opening the deploy page, reviewing the details and signing in their own wallet. The predicted address assumes no other transaction is sent from this wallet first.'
        : 'This deployment would fail if sent now. Nothing was sent.';
      return out;
    }
  },
  {
    name: 'simulate_transaction',
    description: 'Dry-run a transaction against current chain state without sending it. Reports whether it would succeed or revert (and why), the gas and fee estimate, and returns the unsigned transaction for the user to review and sign in their own wallet. Nerby Protocol never signs or broadcasts anything.',
    inputSchema: {
      type: 'object',
      properties: {
        network: netProp, from: addrProp('Sender'), to: addrProp('Recipient or contract'),
        value: { type: 'string', description: 'Amount of native currency to send, in wei (default "0").' },
        data: { type: 'string', description: 'Calldata as 0x hex (default empty).' }
      },
      required: ['network', 'from', 'to']
    },
    run: async (a) => {
      const n = net(a.network);
      let value;
      try { value = BigInt(a.value === undefined || a.value === '' ? 0 : a.value); } catch (e) { throw new ToolError('value must be an integer amount of wei.'); }
      if (value < 0n) throw new ToolError('value cannot be negative.');
      const call = { from: address(a.from, 'from'), to: address(a.to, 'to'), value: toHex(value), data: hexData(a.data, 'data') };
      const [nonce, gasPrice] = await Promise.all([rpc(a.network, 'eth_getTransactionCount', [call.from, 'pending']), rpc(a.network, 'eth_gasPrice', [])]);
      const out = { network: a.network, wouldSucceed: true };
      let gas = null;
      try {
        out.returnData = await rpc(a.network, 'eth_call', [call, 'latest']);
        gas = big(await rpc(a.network, 'eth_estimateGas', [call]));
      } catch (e) {
        if (!e.rpc) throw e;
        out.wouldSucceed = false;
        out.revertReason = e.message;
        if (e.rpc.data) out.revertData = e.rpc.data;
      }
      if (gas !== null) {
        out.gasEstimate = gas;
        out.gasPriceGwei = formatUnits(big(gasPrice), 9);
        out.estimatedFee = formatUnits(gas * big(gasPrice), 18) + ' ' + n.symbol;
      }
      out.sends = formatUnits(value, 18) + ' ' + n.symbol;
      out.unsignedTransaction = { chainId: n.chainId, from: call.from, to: call.to, value: call.value, data: call.data, nonce: num(nonce), gas: gas === null ? null : toHex(gas * 12n / 10n) };
      out.note = out.wouldSucceed
        ? 'Simulation only. Nothing was sent; the user must review and sign this in their own wallet.'
        : 'This transaction would fail if sent now. Nothing was sent.';
      return out;
    }
  }
];

// reads one value from a Pons curve, for graduation progress
async function ponsCurveReader(curve, fn) {
  const r = await readContract('robinhood', curve, fn, [], 'latest');
  return r.result === undefined ? null : r.result;
}

// tools that have a Solana version; everything else is EVM-only
const SOLANA_OK = new Set(Object.keys(solana.HANDLERS).concat(['list_networks', 'get_token_market', 'compile_contract']));

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  args = args || {};
  try {
    let result;
    if (args.network === 'solana') {
      if (!SOLANA_OK.has(name)) throw new ToolError(name + ' works on EVM networks only. On Solana you can use get_balance, get_token_balance, get_block, get_transaction, get_code, get_gas_price, check_token_safety and get_token_market.');
      result = solana.HANDLERS[name] ? await solana.HANDLERS[name](args) : await tool.run(args);
    } else {
      result = await tool.run(args);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }] };
  } catch (e) {
    const known = e instanceof ToolError || e instanceof solana.SolanaError;
    if (!known) console.error(e);
    return { content: [{ type: 'text', text: known ? e.message : 'Unexpected error while running ' + name + '.' }], isError: true };
  }
}

module.exports = {
  NETWORKS,
  toolList: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true } })),
  callTool
};
