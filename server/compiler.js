'use strict';
/* Nerby Protocol — Solidity compilation, token template and deploy-link recipes. */
const zlib = require('zlib');
const crypto = require('crypto');

const MAX_SOURCE = 120000;
const SITE = (process.env.SITE_URL || 'https://www.nerbyprotocol.xyz').replace(/\/+$/, '');

class CompileError extends Error {}

let solc, oz;
function load() {
  if (!solc) { solc = require('solc'); oz = require('./oz.json'); }
}

// Compiles one Solidity file. Imports resolve only to the bundled OpenZeppelin contracts.
function compile(source, contractName) {
  if (typeof source !== 'string' || !source.trim()) throw new CompileError('source must be Solidity code.');
  if (source.length > MAX_SOURCE) throw new CompileError('The source is too large (limit ' + MAX_SOURCE + ' characters).');
  load();
  const input = {
    language: 'Solidity',
    sources: { 'Contract.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), {
    import: (p) => (oz.files[p] ? { contents: oz.files[p] } : { error: 'Only imports from @openzeppelin/contracts (v' + oz.version + ') are available.' })
  }));
  const msgs = out.errors || [];
  const errors = msgs.filter((m) => m.severity === 'error').map((m) => m.formattedMessage.trim());
  const warnings = msgs.filter((m) => m.severity === 'warning' && /Contract\.sol/.test(m.formattedMessage)).map((m) => m.formattedMessage.trim());
  if (errors.length) throw new CompileError('Compilation failed:\n\n' + errors.slice(0, 8).join('\n\n'));

  const built = (out.contracts || {})['Contract.sol'] || {};
  const deployable = Object.keys(built).filter((n) => built[n].evm.bytecode.object);
  if (!deployable.length) throw new CompileError('The source has no deployable contract (only interfaces, libraries or abstract contracts).');
  let name = contractName;
  if (name) {
    if (!deployable.includes(name)) throw new CompileError('No deployable contract named "' + name + '". Found: ' + deployable.join(', ') + '.');
  } else if (deployable.length === 1) {
    name = deployable[0];
  } else {
    throw new CompileError('The source defines several contracts (' + deployable.join(', ') + '). Pass contractName to choose one.');
  }
  return {
    name, abi: built[name].abi, bytecode: '0x' + built[name].evm.bytecode.object, warnings,
    compiler: solc.version().replace(/\.Emscripten.*/, ''), openzeppelin: oz.version
  };
}

// A fixed-supply ERC-20 on OpenZeppelin contracts. Inputs are restricted so they are safe to place in source.
function erc20Source(p) {
  p = p || {};
  const name = String(p.name === undefined ? '' : p.name).trim(), symbol = String(p.symbol === undefined ? '' : p.symbol).trim();
  if (!/^[A-Za-z0-9 ._$-]{1,50}$/.test(name)) throw new CompileError('Token name must be 1–50 characters: letters, digits, spaces and . _ - $');
  if (!/^[A-Za-z0-9$]{1,12}$/.test(symbol)) throw new CompileError('Token symbol must be 1–12 letters, digits or $.');
  const supply = String(p.supply === undefined ? '' : p.supply).replace(/[,_\s]/g, '');
  if (!/^[1-9][0-9]{0,29}$/.test(supply)) throw new CompileError('Supply must be a whole number of tokens, 1 or more.');
  const burnable = !!p.burnable, mintable = !!p.mintable;
  let id = symbol.replace(/[^A-Za-z0-9]/g, '');
  id = !id || /^[0-9]/.test(id) ? 'Token' + id : id;
  const bases = ['ERC20'].concat(burnable ? ['ERC20Burnable'] : [], mintable ? ['Ownable'] : []);
  const source = [
    '// SPDX-License-Identifier: MIT',
    'pragma solidity ^0.8.24;',
    '',
    'import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";',
    burnable ? 'import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";' : null,
    mintable ? 'import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";' : null,
    '',
    '/// ' + name + ' (' + symbol + '): ERC-20 with 18 decimals. The whole initial supply goes to the deployer.',
    'contract ' + id + ' is ' + bases.join(', ') + ' {',
    '    constructor() ERC20("' + name + '", "' + symbol + '")' + (mintable ? ' Ownable(msg.sender)' : '') + ' {',
    '        _mint(msg.sender, ' + supply + ' * 10 ** decimals());',
    '    }',
    mintable ? '\n    /// The owner (initially the deployer) can create more tokens.\n    function mint(address to, uint256 amount) external onlyOwner {\n        _mint(to, amount);\n    }' : null,
    '}',
    ''
  ].filter((l) => l !== null).join('\n');
  return { source, contractName: id, params: { name, symbol, supply, burnable, mintable } };
}

// Deploy links carry a small recipe (never bytecode): deflated JSON, base64url, plus a checksum so a mangled link fails safely.
function encodeRecipe(recipe) {
  const json = JSON.stringify(recipe);
  const sum = crypto.createHash('sha256').update(json).digest('hex').slice(0, 8);
  return SITE + '/deploy.html#r=' + zlib.deflateRawSync(json).toString('base64url') + '.' + sum;
}

module.exports = { compile, erc20Source, encodeRecipe, CompileError, SITE };
