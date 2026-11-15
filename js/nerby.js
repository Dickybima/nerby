/* Nerby Protocol — shared helpers for the Explore and $NERBY pages. */
window.Nerby = (function () {
  'use strict';
  var DEAD = '0x000000000000000000000000000000000000dEaD', ZERO = '0x0000000000000000000000000000000000000000';

  // one HTTP request, many tool calls; each result is {ok, data} or {ok:false, error}
  function batch(calls) {
    return fetch('/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(calls.map(function (c, i) { return { jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: c[0], arguments: c[1] } }; }))
    }).then(function (r) { return r.json(); }).then(function (list) {
      var out = [];
      list.forEach(function (j) {
        if (j.error) { out[j.id] = { ok: false, error: j.error.message }; return; }
        var text = j.result.content[0].text;
        out[j.id] = j.result.isError ? { ok: false, error: text } : { ok: true, data: JSON.parse(text) };
      });
      return out;
    });
  }

  // "1234567.891" from a raw integer string and decimals, without losing precision
  function units(raw, decimals, maxFrac) {
    var v = BigInt(raw), d = BigInt(10) ** BigInt(decimals), whole = v / d, frac = (v % d).toString().padStart(Number(decimals), '0');
    frac = frac.slice(0, maxFrac === undefined ? 4 : maxFrac).replace(/0+$/, '');
    return group(whole.toString()) + (frac ? '.' + frac : '');
  }
  function group(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function trimNum(s, maxFrac) {
    var p = String(s).split('.');
    var f = (p[1] || '').slice(0, maxFrac === undefined ? 6 : maxFrac).replace(/0+$/, '');
    return group(p[0]) + (f ? '.' + f : '');
  }
  function percent(part, whole, digits) {
    if (BigInt(whole) === 0n) return '0';
    var scaled = BigInt(part) * 1000000n / BigInt(whole); // parts per million
    return (Number(scaled) / 10000).toFixed(digits === undefined ? 2 : digits);
  }
  var short = function (a) { return a.slice(0, 6) + '…' + a.slice(-4); };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function link(href, text, cls) {
    var a = el('a', cls, text);
    a.href = href;
    if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }
  function tile(label, value, note, cls) {
    var t = el('div', 'tile ' + (cls || ''));
    t.appendChild(el('span', '', label));
    var b = el('b');
    if (typeof value === 'string') b.textContent = value; else b.appendChild(value);
    t.appendChild(b);
    if (note) { var n = el('small'); if (typeof note === 'string') n.textContent = note; else n.appendChild(note); t.appendChild(n); }
    return t;
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return Math.floor(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  return { DEAD: DEAD, ZERO: ZERO, batch: batch, units: units, trimNum: trimNum, percent: percent, short: short, el: el, link: link, tile: tile, ago: ago };
})();
