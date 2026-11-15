'use strict';
/* Nerby Protocol — chain tools exposed over MCP. Read-only: nothing here holds or uses a private key. */
const { encodeFunctionData, decodeFunctionResult, parseAbiItem, formatUnits, isAddress } = require('viem');

// Public RPC endpoints. Override any of them with an env var, e.g. RPC_ETHEREUM=https://…
const NETWORKS = {
  ethereum: { name: 'Ethereum', chainId: 1, symbol: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com' },
  base: { name: 'Base', chainId: 8453, symbol: 'ETH', rpc: 'https://base-rpc.publicnode.com' },
  arbitrum: { name: 'Arbitrum One', chainId: 42161, symbol: 'ETH', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  optimism: { name: 'OP Mainnet', chainId: 10, symbol: 'ETH', rpc: 'https://optimism-rpc.publicnode.com' },
  polygon: { name: 'Polygon', chainId: 137, symbol: 'POL', rpc: 'https://polygon-bor-rpc.publicnode.com' },
  bsc: { name: 'BNB Smart Chain', chainId: 56, symbol: 'BNB', rpc: 'https://bsc-rpc.publicnode.com' }
};
const NETWORK_IDS = Object.keys(NETWORKS);

class ToolError extends Error {}

function net(id) {
  const n = NETWORKS[id];
  if (!n) throw new ToolError(`Unknown network "${id}". Use one of: ${NETWORK_IDS.join(', ')}.`);
  return n;
}

async function rpc(network, method, params) {
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

const netProp = { type: 'string', enum: NETWORK_IDS, description: 'Network to query.' };
const addrProp = (d) => ({ type: 'string', description: d + ' (0x address).' });
const blockProp = { type: ['string', 'integer'], description: 'Block number, or "latest" (default).' };

const TOOLS = [
  {
    name: 'list_networks',
    description: 'List the networks Nerby Protocol can reach, with chain IDs and native currency.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => NETWORK_IDS.map((id) => ({ id, name: NETWORKS[id].name, chainId: NETWORKS[id].chainId, nativeCurrency: NETWORKS[id].symbol }))
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

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  try {
    const result = await tool.run(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }] };
  } catch (e) {
    if (!(e instanceof ToolError)) console.error(e);
    return { content: [{ type: 'text', text: e instanceof ToolError ? e.message : 'Unexpected error while running ' + name + '.' }], isError: true };
  }
}

module.exports = {
  NETWORKS,
  toolList: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true } })),
  callTool
};
