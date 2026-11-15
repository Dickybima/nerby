'use strict';
/* Bundles the OpenZeppelin Solidity sources into server/oz.json so the compiler
   can resolve "@openzeppelin/contracts/..." imports without touching the filesystem.
   Re-run after upgrading @openzeppelin/contracts:  node scripts/bundle-oz.js */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'node_modules', '@openzeppelin', 'contracts');
const out = { version: require(path.join(root, 'package.json')).version, files: {} };
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'mocks' && e.name !== 'build') walk(p); }
    else if (e.name.endsWith('.sol')) out.files['@openzeppelin/contracts/' + path.relative(root, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
  }
})(root);
fs.writeFileSync(path.join(__dirname, '..', 'server', 'oz.json'), JSON.stringify(out));
console.log(Object.keys(out.files).length + ' files, OpenZeppelin ' + out.version);
