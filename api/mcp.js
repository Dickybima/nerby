'use strict';
/* Nerby Protocol — MCP endpoint (Streamable HTTP, stateless JSON responses). */
const { toolList, callTool } = require('../server/tools');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INFO = { name: 'nerby-protocol', title: 'Nerby Protocol', version: '0.6.0' };
const INSTRUCTIONS =
  'Nerby Protocol gives access to twelve EVM networks and Solana (call list_networks first; Robinhood Chain is "robinhood", Solana is "solana" and has its own smaller tool set). ' +
  'No tool signs or sends anything. simulate_transaction dry-runs a transaction. ' +
  'prepare_deployment compiles a contract and returns a deployUrl: give that link to the user, with the fee and what the contract does, ' +
  'so they can review it and sign in their own wallet. Never ask the user for a private key or seed phrase.';

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(null, -32600, 'Invalid request');
  if (typeof msg.method !== 'string') return undefined; // a response from the client: nothing to answer
  if (msg.id === undefined || msg.id === null) return undefined; // notification
  const p = msg.params || {};
  switch (msg.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0', id: msg.id,
        result: {
          protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[0],
          capabilities: { tools: {} }, serverInfo: INFO, instructions: INSTRUCTIONS
        }
      };
    case 'ping':
      return { jsonrpc: '2.0', id: msg.id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id: msg.id, result: { tools: toolList } };
    case 'tools/call': {
      if (typeof p.name !== 'string') return rpcError(msg.id, -32602, 'Missing tool name');
      const result = await callTool(p.name, p.arguments);
      return result ? { jsonrpc: '2.0', id: msg.id, result } : rpcError(msg.id, -32602, 'Unknown tool: ' + p.name);
    }
    default:
      return rpcError(msg.id, -32601, 'Method not found: ' + msg.method);
  }
}

function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version');
  const send = (status, body) => {
    res.statusCode = status;
    if (body === undefined) return res.end();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') return send(204);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(405, rpcError(null, -32000, 'This is an MCP endpoint. Add this URL to an MCP client; it only accepts POST.'));
  }

  let body;
  try { body = await readBody(req); } catch (e) { return send(400, rpcError(null, -32700, 'Parse error')); }

  if (Array.isArray(body)) {
    if (!body.length || body.length > 20) return send(400, rpcError(null, -32600, 'Invalid batch'));
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? send(200, out) : send(202);
  }
  const out = await handle(body);
  return out ? send(200, out) : send(202);
};
