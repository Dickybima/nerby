'use strict';
/* Local preview: serves the static site and the MCP endpoint at /mcp.  →  npm run dev */
const http = require('http');
const fs = require('fs');
const path = require('path');
const mcp = require('../api/mcp');
const marketApi = require('../api/market');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.env.PORT) || 3000;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/mcp' || url.pathname === '/api/mcp') return mcp(req, res);
  if (url.pathname === '/api/market') return marketApi(req, res);
  if (url.pathname === '/api/og') return require('../api/og')(req, res);
  if (url.pathname === '/s/nerby' || url.pathname === '/api/share') return require('../api/share')(req, res);
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(root, rel);
  const top = rel.split('/')[0];
  if (!file.startsWith(root + path.sep) || !(/^[a-z-]+\.html$/.test(rel) || ['css', 'js', 'img', 'brand'].includes(top))) { res.statusCode = 404; return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(port, () => console.log(`Nerby Protocol on http://localhost:${port}  (MCP endpoint: http://localhost:${port}/mcp)`));
