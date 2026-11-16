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

  // like batch, but asks again for calls that failed (public RPCs rate-limit bursts)
  function batchRetry(calls, tries) {
    tries = tries === undefined ? 2 : tries;
    return batch(calls).then(function (res) {
      var bad = []; res.forEach(function (r, i) { if (!r || !r.ok) bad.push(i); });
      if (!bad.length || !tries) return res;
      return new Promise(function (ok) { setTimeout(ok, 700); }).then(function () {
        return batchRetry(bad.map(function (i) { return calls[i]; }), tries - 1);
      }).then(function (again) { bad.forEach(function (i, k) { if (again[k] && again[k].ok) res[i] = again[k]; }); return res; });
    });
  }

  // renders the result of the check_token_safety tool into a container
  // Blockscout sits behind a bot check that blocks our server but not browsers,
  // so a "not verified" answer is double-checked from the visitor's browser.
  function blockscoutVerified(base, address) {
    if (!base) return Promise.resolve(null);
    return fetch(base + '/api/v2/smart-contracts/' + address).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.is_verified ? j : null; }).catch(function () { return null; });
  }

  function safety(box, d) {
    var i = d.checks.findIndex(function (c) { return c.title === 'Source not verified'; });
    if (i >= 0 && d.blockscout && !d.__rechecked) {
      d.__rechecked = true;
      blockscoutVerified(d.blockscout, d.address).then(function (j) {
        if (!j) return;
        d.checks[i] = { level: 'ok', title: 'Source verified', detail: 'Verified on Blockscout' + (j.name ? ' as ' + j.name : '') + '.' };
        d.summary = d.checks.some(function (c) { return c.level === 'warn'; }) ? 'Some powers or unknowns need a closer look.' : 'No red flags found in this quick check.';
        safety(box, d);
      });
    }
    box.textContent = '';
    var head = el('div', 'sfhead ' + (d.checks.some(function (c) { return c.level === 'warn'; }) ? 'warn' : 'ok'));
    head.appendChild(el('b', '', d.summary));
    head.appendChild(el('small', '', d.note));
    box.appendChild(head);
    d.checks.forEach(function (c) {
      var row = el('div', 'sfrow ' + c.level);
      row.appendChild(el('i', '', c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : 'i'));
      var t = el('div'); t.appendChild(el('b', '', c.title)); t.appendChild(el('span', '', c.detail));
      row.appendChild(t); box.appendChild(row);
    });
  }

  return { blockscoutVerified: blockscoutVerified, batchRetry: batchRetry, safety: safety, DEAD: DEAD, ZERO: ZERO, batch: batch, units: units, trimNum: trimNum, percent: percent, short: short, el: el, link: link, tile: tile, ago: ago };
})();
