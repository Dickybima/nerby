/* Nerby Protocol — live $NERBY dashboard. Numbers come from the chain and refresh on their own. */
(function () {
  'use strict';
  var N = window.Nerby, $ = function (id) { return document.getElementById(id); };
  var CA = '0xd17d0eabf76f2b3144da726efd341761f4697113', NET = 'robinhood', EXPLORER = 'https://robinhoodchain.blockscout.com';
  var shown = null, last = 0;

  function call(fn, args) { return ['call_contract', { network: NET, address: CA, function: fn, args: args || [] }]; }

  // count up to the new burned figure instead of jumping
  function animate(el, from, to, dec) {
    var t0 = performance.now(), dur = 1400, f = BigInt(from), d = BigInt(to) - f;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = N.units((f + d * BigInt(Math.round(e * 1000)) / 1000n).toString(), dec, 0);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function refresh() {
    return N.batch([
      call('totalSupply() view returns (uint256)'), call('decimals() view returns (uint8)'),
      call('balanceOf(address) view returns (uint256)', [N.DEAD]), call('balanceOf(address) view returns (uint256)', [N.ZERO]),
      ['get_block', { network: NET }]
    ]).then(function (r) {
      if (!r[0].ok || !r[1].ok || !r[2].ok) throw new Error('read failed');
      var dec = Number(r[1].data.result), supply = r[0].data.result;
      var burned = (BigInt(r[2].data.result) + BigInt(r[3].ok ? r[3].data.result : 0)).toString();
      var pct = N.percent(burned, supply, 3);
      if (shown === null) animate($('kburn'), 0, burned, dec); else if (shown !== burned) animate($('kburn'), shown, burned, dec);
      shown = burned;
      $('kpct').textContent = pct + '%';
      $('kbar').style.width = Math.min(100, Math.max(0.6, Number(pct))) + '%';
      $('ksupply').textContent = N.units(supply, dec, 0);
      $('kleft').textContent = N.units((BigInt(supply) - BigInt(burned)).toString(), dec, 0);
      if (r[4].ok) $('kblock').textContent = r[4].data.number.toLocaleString();
      last = Date.now();
      $('klive').classList.add('on');
    }).catch(function () { $('klive').classList.remove('on'); });
  }

  // the list of burn transactions comes straight from the public block explorer
  function burns() {
    fetch(EXPLORER + '/api/v2/addresses/' + N.DEAD + '/token-transfers?type=ERC-20&filter=to&token=' + CA).then(function (r) { return r.json(); }).then(function (j) {
      var items = (j.items || []).slice(0, 12), box = $('kburns');
      if (!items.length) return;
      box.textContent = '';
      items.forEach(function (i) {
        var row = N.el('div', 'brow');
        row.appendChild(N.el('span', 'hot', '🔥 ' + N.units(i.total.value, Number(i.total.decimals), 0) + ' NERBY'));
        row.appendChild(N.el('span', '', N.ago(i.timestamp)));
        row.appendChild(N.link(EXPLORER + '/tx/' + i.transaction_hash, N.short(i.transaction_hash)));
        box.appendChild(row);
      });
      $('kburnsec').hidden = false;
    }).catch(function () {});
    fetch(EXPLORER + '/api/v2/tokens/' + CA).then(function (r) { return r.json(); }).then(function (j) {
      if (j.holders_count) { $('kholders').textContent = Number(j.holders_count).toLocaleString(); $('kholderst').hidden = false; }
    }).catch(function () {});
  }

  $('kcheck').addEventListener('submit', function (e) {
    e.preventDefault();
    var a = $('kaddr').value.trim(), out = $('kbal');
    out.className = 'dstatus'; out.textContent = 'Reading…';
    N.batch([['get_token_balance', { network: NET, token: CA, address: a }]]).then(function (r) {
      if (!r[0].ok) { out.className = 'dstatus err'; out.textContent = r[0].error; return; }
      out.className = 'dstatus ok'; out.textContent = N.short(a) + ' holds ' + N.trimNum(r[0].data.balance, 2) + ' NERBY';
    });
  });

  setInterval(function () { if (last) $('kago').textContent = Math.round((Date.now() - last) / 1000) + 's ago'; }, 1000);
  setInterval(function () { if (!document.hidden) refresh(); }, 20000);
  setInterval(function () { if (!document.hidden) burns(); }, 60000);
  refresh(); burns();
})();

/* holders, burn chart and safety check */
(function () {
  'use strict';
  var N = window.Nerby, $ = function (id) { return document.getElementById(id); };
  var CA = '0xd17d0eabf76f2b3144da726efd341761f4697113', NET = 'robinhood', EXPLORER = 'https://robinhoodchain.blockscout.com';
  var SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, parent) { var e = document.createElementNS(SVG, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }

  N.batch([['check_token_safety', { network: NET, address: CA }]]).then(function (r) {
    if (r[0].ok) { N.safety($('ksafe'), r[0].data); $('ksafesec').hidden = false; }
  });

  // cumulative burned amount over time, one step per burn transaction
  fetch(EXPLORER + '/api/v2/addresses/' + N.DEAD + '/token-transfers?type=ERC-20&filter=to&token=' + CA).then(function (r) { return r.json(); }).then(function (j) {
    var items = (j.items || []).slice().reverse();
    if (!items.length) return;
    var dec = Number(items[0].total.decimals), unit = 10n ** BigInt(dec), run = 0, pts = [];
    items.forEach(function (i) { run += Number(BigInt(i.total.value) / unit); pts.push({ t: new Date(i.timestamp).getTime(), v: run, tx: i.transaction_hash, add: Number(BigInt(i.total.value) / unit) }); });
    var now = Date.now(), t0 = pts[0].t - (now - pts[0].t) * 0.06, W = 1000, H = 280, P = { l: 8, r: 8, t: 20, b: 34 };
    var x = function (t) { return P.l + (t - t0) / (now - t0) * (W - P.l - P.r); }, max = run * 1.12;
    var y = function (v) { return P.t + (1 - v / max) * (H - P.t - P.b); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Cumulative NERBY burned over time' });
    var g = s('linearGradient', { id: 'kg', x1: 0, y1: 0, x2: 0, y2: 1 }, s('defs', {}, svg));
    s('stop', { offset: '0', 'stop-color': '#ff8a2a', 'stop-opacity': '.38' }, g); s('stop', { offset: '1', 'stop-color': '#ff8a2a', 'stop-opacity': '0' }, g);
    [0.25, 0.5, 0.75, 1].forEach(function (f) { s('line', { x1: P.l, x2: W - P.r, y1: y(max * f / 1.12), y2: y(max * f / 1.12), class: 'kgrid' }, svg); });
    var d = 'M' + x(t0) + ',' + y(0), prev = 0;
    pts.forEach(function (p) { d += ' L' + x(p.t) + ',' + y(prev) + ' L' + x(p.t) + ',' + y(p.v); prev = p.v; });
    d += ' L' + x(now) + ',' + y(prev);
    s('path', { d: d + ' L' + x(now) + ',' + y(0) + ' Z', fill: 'url(#kg)' }, svg);
    s('path', { d: d, class: 'kline', 'vector-effect': 'non-scaling-stroke' }, svg);
    var tip = $('ktip');
    pts.forEach(function (p) {
      var c = s('circle', { cx: x(p.t), cy: y(p.v), r: 5, class: 'kdot' }, svg);
      var show = function () { tip.textContent = '+' + p.add.toLocaleString() + ' NERBY · ' + new Date(p.t).toLocaleString() + ' · total ' + p.v.toLocaleString(); tip.hidden = false; };
      c.addEventListener('mouseenter', show); c.addEventListener('focus', show); c.setAttribute('tabindex', '0');
      c.addEventListener('click', function () { window.open(EXPLORER + '/tx/' + p.tx, '_blank', 'noopener'); });
    });
    var box = $('kchart'); box.textContent = ''; box.appendChild(svg);
    $('kaxis').textContent = '';
    $('kaxis').appendChild(N.el('span', '', new Date(pts[0].t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
    $('kaxis').appendChild(N.el('span', '', 'now'));
    $('kchartsec').hidden = false;
  }).catch(function () {});

  // top holders, with liquidity pools and the burn address labelled
  fetch(EXPLORER + '/api/v2/tokens/' + CA + '/holders').then(function (r) { return r.json(); }).then(function (j) {
    var items = (j.items || []).slice(0, 10);
    if (!items.length) return;
    var supply = 1000000000n * 10n ** 18n;
    var contracts = items.filter(function (i) { return i.address.is_contract; });
    return N.batch(contracts.map(function (i) { return ['call_contract', { network: NET, address: i.address.hash, function: 'token0() view returns (address)' }]; })).then(function (r) {
      var pools = {};
      contracts.forEach(function (c, k) { if (r[k] && r[k].ok) pools[c.address.hash.toLowerCase()] = true; });
      var box = $('kholderlist'); box.textContent = '';
      items.forEach(function (i, k) {
        var a = i.address.hash, low = a.toLowerCase();
        var label = /dead$/i.test(low) || /^0x0{40}$/.test(low) ? 'Burn address' : pools[low] ? 'Liquidity pool' : i.address.is_contract ? 'Contract' : 'Wallet';
        var pct = Number(BigInt(i.value) * 1000000n / supply) / 10000;
        var row = N.el('div', 'hrow');
        row.appendChild(N.el('span', 'hk', String(k + 1)));
        var who = N.el('div', 'hw'); who.appendChild(N.link('explore.html#robinhood/' + a, N.short(a), 'mono')); who.appendChild(N.el('small', label === 'Wallet' ? '' : label === 'Burn address' ? 'hot' : 'tag', label)); row.appendChild(who);
        var bar = N.el('div', 'hb'); var fill = N.el('i'); fill.style.width = Math.max(0.5, pct) + '%'; if (label === 'Burn address') fill.className = 'burn'; bar.appendChild(fill); row.appendChild(bar);
        row.appendChild(N.el('span', 'hp', pct.toFixed(2) + '%'));
        box.appendChild(row);
      });
      $('kholdersec').hidden = false;
    });
  }).catch(function () {});
})();
