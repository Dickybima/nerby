/* Nerby Protocol — the $NERBY page. Market data comes from the DEX pool (via /api/market),
   supply and burns are read from Robinhood Chain, history comes from the public block explorer. */
(function () {
  'use strict';
  var N = window.Nerby, $ = function (id) { return document.getElementById(id); };
  var CA = '0xd17d0eabf76f2b3144da726efd341761f4697113', NET = 'robinhood', EXPLORER = 'https://robinhoodchain.blockscout.com';
  var SVG = 'http://www.w3.org/2000/svg', UNIT = 10n ** 18n, SUPPLY = 1000000000;
  var state = { burned: null, supply: null, price: null, ethUsd: null, pool: null, deployer: null, buyback: null };

  // ---------- formatting ----------
  function usd(v, compact) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (compact && Math.abs(v) >= 1000) {
      var u = [['B', 1e9], ['M', 1e6], ['K', 1e3]].filter(function (x) { return Math.abs(v) >= x[1]; })[0];
      return '$' + (v / u[1]).toFixed(v / u[1] >= 100 ? 0 : 2).replace(/\.?0+$/, '') + u[0];
    }
    return '$' + v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 });
  }
  function price(p) {
    if (!p) return '—';
    if (p >= 0.01) return '$' + p.toFixed(4);
    var zeros = Math.max(0, -Math.floor(Math.log10(p)) - 1);
    return '$' + p.toFixed(zeros + 4);
  }
  function tokens(v) { return Math.round(v).toLocaleString(); }
  function big(raw) { return Number(BigInt(raw) / UNIT) + Number(BigInt(raw) % UNIT) / 1e18; }
  function s(tag, attrs, parent) { var e = document.createElementNS(SVG, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function set(id, v) { var e = $(id); if (e) e.textContent = v; }
  function ago(t) { return N.ago(t); }

  // ---------- market ----------
  function market() {
    return fetch('/api/market?network=' + NET + '&token=' + CA).then(function (r) { return r.json(); }).then(function (m) {
      if (m.error || !m.listed) { set('mnote', m.error || 'No trading pool found yet.'); return; }
      var p = m.pools[0] || {};
      state.price = m.priceUsd; state.pool = (p.address || '').toLowerCase(); state.ethUsd = p.quotePriceUsd;
      set('mprice', price(m.priceUsd));
      var ch = p.priceChange ? Number(p.priceChange.h24) : null, chEl = $('mchg');
      chEl.textContent = ch === null ? '' : (ch >= 0 ? '▲ ' : '▼ ') + Math.abs(ch).toFixed(2) + '% 24h';
      chEl.className = 'mchg ' + (ch >= 0 ? 'up' : 'down');
      set('mfdv', usd(m.priceUsd * SUPPLY, true));
      set('mliq', usd(p.liquidityUsd || m.liquidityUsd, true));
      set('mvol', usd(m.volume24hUsd, true));
      var tx = p.transactions && p.transactions.h24;
      set('mtx', tx ? tx.buys.toLocaleString() + ' / ' + tx.sells.toLocaleString() : '—');
      set('mtxn', tx ? tx.buyers + ' buyers · ' + tx.sellers + ' sellers' : '');
      set('mpool', (p.name || 'Pool') + ' · ' + (p.dex || 'DEX').replace(/-/g, ' '));
      $('mpoollink').href = p.url || '#';
      set('mupdated', 'Market data ' + (m.stale ? 'delayed' : 'updated') + ' ' + new Date().toLocaleTimeString() + ' · GeckoTerminal');
      [1, 6, 24].forEach(function (h) {
        var k = 'h' + h, v = p.priceChange && p.priceChange[k];
        var e = $('mc' + h); if (!e || v === undefined) return;
        e.textContent = (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(2) + '%'; e.className = Number(v) >= 0 ? 'up' : 'down';
      });
      mcap();
      var c = m.candles || [];
      if (c.length < 2 && m.trades && m.trades.length > 1) c = m.trades.slice().reverse().map(function (t) { var v = t.priceUsd; return { t: new Date(t.time).getTime(), o: v, h: v, l: v, c: v, v: t.usd }; });
      chart(c);
      trades(m.trades || []);
      buybacks();
      $('marketsec').hidden = false;
    }).catch(function () { set('mnote', 'Market data is not reachable right now.'); });
  }
  function mcap() {
    if (state.price === null || state.burned === null) return;
    var circ = SUPPLY - state.burned;
    set('mmcap', usd(state.price * circ, true));
    set('mmcapn', tokens(circ) + ' circulating × price');
  }

  // ---------- price chart ----------
  function chart(c) {
    if (c.length < 2) return;
    var W = 1000, H = 300, P = { l: 6, r: 6, t: 16, b: 16 };
    var lo = Math.min.apply(null, c.map(function (x) { return x.l; })), hi = Math.max.apply(null, c.map(function (x) { return x.h; }));
    var pad = (hi - lo) * 0.08 || hi * 0.05; lo -= pad; hi += pad;
    var t0 = c[0].t, t1 = c[c.length - 1].t;
    var x = function (t) { return P.l + (t - t0) / (t1 - t0 || 1) * (W - P.l - P.r); }, y = function (v) { return P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'NERBY price, 15-minute candles' });
    var g = s('linearGradient', { id: 'pg', x1: 0, y1: 0, x2: 0, y2: 1 }, s('defs', {}, svg));
    s('stop', { offset: '0', 'stop-color': '#a1f837', 'stop-opacity': '.32' }, g); s('stop', { offset: '1', 'stop-color': '#a1f837', 'stop-opacity': '0' }, g);
    [0.25, 0.5, 0.75].forEach(function (f) { s('line', { x1: P.l, x2: W - P.r, y1: P.t + f * (H - P.t - P.b), y2: P.t + f * (H - P.t - P.b), class: 'kgrid' }, svg); });
    var d = c.map(function (k, i) { return (i ? 'L' : 'M') + x(k.t).toFixed(1) + ',' + y(k.c).toFixed(1); }).join(' ');
    s('path', { d: d + ' L' + x(t1) + ',' + H + ' L' + x(t0) + ',' + H + ' Z', fill: 'url(#pg)' }, svg);
    s('path', { d: d, class: 'pline', 'vector-effect': 'non-scaling-stroke' }, svg);
    var cross = s('line', { y1: 0, y2: H, class: 'pcross', visibility: 'hidden' }, svg);
    var box = $('pchart'); box.textContent = ''; box.appendChild(svg);
    var tip = $('ptip');
    svg.addEventListener('mousemove', function (e) {
      var r = svg.getBoundingClientRect(), t = t0 + (e.clientX - r.left) / r.width * (t1 - t0);
      var k = c.reduce(function (a, b) { return Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a; });
      cross.setAttribute('x1', x(k.t)); cross.setAttribute('x2', x(k.t)); cross.setAttribute('visibility', 'visible');
      tip.textContent = new Date(k.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · ' + price(k.c) + ' · volume ' + usd(k.v, true);
    });
    svg.addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); tip.textContent = 'Hover the chart for the price at any point.'; });
    set('paxis0', new Date(t0).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    set('paxishi', 'High ' + price(hi - pad) + ' · Low ' + price(lo + pad));
  }

  // ---------- recent trades ----------
  var lastTrades = [];
  function trades(list) {
    lastTrades = list;
    var box = $('trades'); box.textContent = '';
    list.slice(0, 25).forEach(function (t) {
      var row = N.el('div', 'trow ' + t.kind);
      row.appendChild(N.el('span', 'tk', t.kind === 'buy' ? 'Buy' : 'Sell'));
      row.appendChild(N.el('span', 'ta', tokens(t.amount) + ' NERBY'));
      row.appendChild(N.el('span', 'tu', (t.usd >= 100 ? '🐋 ' : '') + usd(t.usd)));
      var w = N.el('span', 'twl'); w.appendChild(N.link('explore.html#robinhood/' + t.wallet, N.short(t.wallet)));
      if (state.buyback && t.wallet.toLowerCase() === state.buyback) w.appendChild(N.el('small', 'hot', 'Buyback'));
      row.appendChild(w);
      row.appendChild(N.link(EXPLORER + '/tx/' + t.tx, ago(t.time), 'tt'));
      box.appendChild(row);
    });
    $('tradesec').hidden = !list.length;
  }

  // ---------- on-chain supply and burn ----------
  var shown = null;
  function animate(el, from, to) {
    var t0 = performance.now(), dur = 1400;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = tokens(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  var chainSeq = 0;
  function chain() {
    var mine = ++chainSeq;
    var call = function (fn, args) { return ['call_contract', { network: NET, address: CA, function: fn, args: args || [] }]; };
    var extra = [state.pool, state.deployer, state.buyback].map(function (a) { return a ? call('balanceOf(address) view returns (uint256)', [a]) : ['list_networks', {}]; });
    return N.batch([
      call('totalSupply() view returns (uint256)'),
      call('balanceOf(address) view returns (uint256)', [N.DEAD]), call('balanceOf(address) view returns (uint256)', [N.ZERO]),
      ['get_block', { network: NET }]
    ].concat(extra)).then(function (r) {
      if (mine !== chainSeq) return;
      if (!r[0].ok || !r[1].ok) throw new Error('read failed');
      var supply = big(r[0].data.result), burned = big(r[1].data.result) + (r[2].ok ? big(r[2].data.result) : 0);
      state.supply = supply; state.burned = burned;
      if (shown === null) animate($('kburn'), 0, burned); else if (shown !== burned) animate($('kburn'), shown, burned);
      shown = burned;
      var pct = burned / supply * 100;
      set('kpct', pct.toFixed(3) + '%'); $('kbar').style.width = Math.min(100, Math.max(0.6, pct)) + '%';
      set('ksupply', tokens(supply)); set('kcirc', tokens(supply - burned));
      if (r[3].ok) set('kblock', r[3].data.number.toLocaleString());
      if (state.price !== null) set('kburnusd', '≈ ' + usd(burned * state.price) + ' at today’s price');
      mcap();
      // supply breakdown
      var val = function (i) { return r[i] && r[i].ok && r[i].data.result !== undefined ? big(r[i].data.result) : 0; };
      var parts = [['Burned', burned, 'sx-burn'], ['Liquidity pool', state.pool ? val(4) : 0, 'sx-pool'], ['Deployer wallet', state.deployer ? val(5) : 0, 'sx-dev'], ['Buyback wallet', state.buyback ? val(6) : 0, 'sx-bb']];
      var rest = supply - parts.reduce(function (a, p) { return a + p[1]; }, 0);
      parts.push(['All other holders', rest, 'sx-rest']);
      var bar = $('sbar'), legend = $('slegend'); bar.textContent = ''; legend.textContent = '';
      parts.forEach(function (p) {
        var w = p[1] / supply * 100, i = N.el('i', p[2]); i.style.width = w + '%'; i.title = p[0]; bar.appendChild(i);
        var l = N.el('div', 'sl'); l.appendChild(N.el('i', p[2])); l.appendChild(N.el('span', '', p[0])); l.appendChild(N.el('b', '', w.toFixed(2) + '%')); l.appendChild(N.el('small', '', tokens(p[1]))); legend.appendChild(l);
      });
      last = Date.now(); $('klive').classList.add('on');
    }).catch(function () { $('klive').classList.remove('on'); });
  }
  var last = 0;

  // ---------- buyback and burn history (block explorer) ----------
  function bs(path) { return fetch(EXPLORER + '/api/v2' + path).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function allPages(path, max) {
    var out = [];
    return (function next(params, n) {
      return bs(path + (params ? '&' + new URLSearchParams(params).toString() : '')).then(function (j) {
        out = out.concat(j.items || []);
        return j.next_page_params && n < max ? next(j.next_page_params, n + 1) : out;
      });
    })(null, 1);
  }
  var bbDone = false;
  function buybacks() {
    if (bbDone || !state.pool) return;
    bbDone = true;
    allPages('/addresses/' + N.DEAD + '/token-transfers?type=ERC-20&filter=to&token=' + CA, 4).then(function (burns) {
      // the buyback wallet is whoever sent the most NERBY to the burn address
      var by = {};
      burns.forEach(function (b) { var f = b.from.hash.toLowerCase(); by[f] = (by[f] || 0) + big(b.total.value); });
      var top = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })[0];
      state.buyback = top || null;
      trades(lastTrades); holders();
      burnChart(burns);
      set('kcount', burns.length.toLocaleString());
      if (!top) return;
      $('bwallet').textContent = ''; $('bwallet').appendChild(N.link('explore.html#robinhood/' + top, N.short(top)));
      return allPages('/addresses/' + top + '/token-transfers?type=ERC-20&filter=to&token=' + CA, 4).then(function (ins) {
        var buys = ins.filter(function (i) { return i.from.hash.toLowerCase() === state.pool; });
        var bought = buys.reduce(function (a, b) { return a + big(b.total.value); }, 0);
        set('bbought', tokens(bought)); set('bbuys', buys.length + ' buys from the pool');
        var txEth = {}, list = buys.slice(0, 40);
        var read = function (todo) {
          return N.batch(todo.map(function (b) { return ['get_transaction', { network: NET, hash: b.transaction_hash }]; })).then(function (r) {
            r.forEach(function (x, i) { if (x && x.ok) txEth[todo[i].transaction_hash] = Number(x.data.value); });
          });
        };
        var missing = function () { return list.filter(function (b) { return !(b.transaction_hash in txEth); }); };
        return read(list).then(function () {
          return missing().length ? new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return read(missing()); }) : null;
        }).then(function () {
          var eth = 0, paid = 0;
          list.forEach(function (b) { var v = txEth[b.transaction_hash]; if (v > 0) { eth += v; paid++; } });
          var gap = missing().length;
          set('beth', paid ? (gap ? 'at least ' : '') + eth.toFixed(4) + ' ETH' : '—');
          set('bethn', paid ? (state.ethUsd ? '≈ ' + usd(eth * state.ethUsd) + ' at today’s ETH price' : '') + (gap ? ' · ' + gap + ' of ' + list.length + ' buys not read yet' : '') : 'Paid in a way this page cannot read');
          timeline(buys, burns.filter(function (b) { return b.from.hash.toLowerCase() === top; }), txEth);
        });
      });
    }).catch(function () { set('bbought', '—'); });
  }
  function timeline(buys, burns, txEth) {
    var ev = buys.map(function (b) { return { t: b.timestamp, k: 'buy', v: big(b.total.value), tx: b.transaction_hash }; })
      .concat(burns.map(function (b) { return { t: b.timestamp, k: 'burn', v: big(b.total.value), tx: b.transaction_hash }; }))
      .sort(function (a, b) { return new Date(b.t) - new Date(a.t); });
    var box = $('btimeline'); box.textContent = '';
    ev.slice(0, 30).forEach(function (e) {
      var row = N.el('div', 'brow ' + e.k);
      row.appendChild(N.el('span', e.k === 'burn' ? 'hot' : 'up', (e.k === 'burn' ? '🔥 Burned ' : '↺ Bought back ') + tokens(e.v) + ' NERBY' + (txEth[e.tx] ? ' for ' + txEth[e.tx].toFixed(4) + ' ETH' : '')));
      row.appendChild(N.el('span', '', ago(e.t)));
      row.appendChild(N.link(EXPLORER + '/tx/' + e.tx, N.short(e.tx)));
      box.appendChild(row);
    });
    $('btimesec').hidden = !ev.length;
  }
  function burnChart(items) {
    items = items.slice().reverse();
    if (!items.length) return;
    var run = 0, pts = items.map(function (i) { run += big(i.total.value); return { t: new Date(i.timestamp).getTime(), v: run, add: big(i.total.value), tx: i.transaction_hash }; });
    var now = Date.now(), t0 = pts[0].t - (now - pts[0].t) * 0.06, W = 1000, H = 240, P = { l: 8, r: 8, t: 18, b: 18 };
    var x = function (t) { return P.l + (t - t0) / (now - t0) * (W - P.l - P.r); }, max = run * 1.12, y = function (v) { return P.t + (1 - v / max) * (H - P.t - P.b); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Cumulative NERBY burned' });
    var g = s('linearGradient', { id: 'kg', x1: 0, y1: 0, x2: 0, y2: 1 }, s('defs', {}, svg));
    s('stop', { offset: '0', 'stop-color': '#ff8a2a', 'stop-opacity': '.38' }, g); s('stop', { offset: '1', 'stop-color': '#ff8a2a', 'stop-opacity': '0' }, g);
    var d = 'M' + x(t0) + ',' + y(0), prev = 0;
    pts.forEach(function (p) { d += ' L' + x(p.t) + ',' + y(prev) + ' L' + x(p.t) + ',' + y(p.v); prev = p.v; });
    d += ' L' + x(now) + ',' + y(prev);
    s('path', { d: d + ' L' + x(now) + ',' + y(0) + ' Z', fill: 'url(#kg)' }, svg);
    s('path', { d: d, class: 'kline', 'vector-effect': 'non-scaling-stroke' }, svg);
    pts.forEach(function (p) {
      var c = s('circle', { cx: x(p.t), cy: y(p.v), r: 5, class: 'kdot', tabindex: 0 }, svg);
      var show = function () { set('ktip', '+' + tokens(p.add) + ' NERBY · ' + new Date(p.t).toLocaleString() + ' · total ' + tokens(p.v)); };
      c.addEventListener('mouseenter', show); c.addEventListener('focus', show);
      c.addEventListener('click', function () { window.open(EXPLORER + '/tx/' + p.tx, '_blank', 'noopener'); });
    });
    var box = $('kchart'); box.textContent = ''; box.appendChild(svg);
    set('kaxis0', new Date(pts[0].t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
  }

  // ---------- holders ----------
  function holders() {
    bs('/tokens/' + CA).then(function (j) { if (j.holders_count) set('mholders', Number(j.holders_count).toLocaleString()); }).catch(function () {});
    bs('/tokens/' + CA + '/holders').then(function (j) {
      var items = (j.items || []).slice(0, 15), box = $('kholderlist'); box.textContent = '';
      items.forEach(function (i, k) {
        var a = i.address.hash, low = a.toLowerCase();
        var label = /dead$/i.test(low) || /^0x0{40}$/.test(low) ? 'Burn address' : low === state.pool ? 'Liquidity pool' : low === state.deployer ? 'Deployer' : low === state.buyback ? 'Buyback wallet' : i.address.is_contract ? 'Contract' : 'Wallet';
        var pct = big(i.value) / SUPPLY * 100, row = N.el('div', 'hrow');
        row.appendChild(N.el('span', 'hk', String(k + 1)));
        var who = N.el('div', 'hw'); who.appendChild(N.link('explore.html#robinhood/' + a, N.short(a), 'mono'));
        who.appendChild(N.el('small', label === 'Wallet' ? '' : label === 'Burn address' ? 'hot' : 'tag', label)); row.appendChild(who);
        var bar = N.el('div', 'hb'), fill = N.el('i'); fill.style.width = Math.max(0.5, pct) + '%'; if (label === 'Burn address') fill.className = 'sx-burn'; bar.appendChild(fill); row.appendChild(bar);
        row.appendChild(N.el('span', 'hp', pct.toFixed(2) + '%'));
        box.appendChild(row);
      });
      $('kholdersec').hidden = !items.length;
    }).catch(function () {});
  }

  // ---------- safety ----------
  N.batch([['check_token_safety', { network: NET, address: CA }]]).then(function (r) { if (r[0].ok) N.safety($('ksafe'), r[0].data); else set('ksafe', 'The safety check could not run right now.'); });

  // ---------- balance checker ----------
  $('kcheck').addEventListener('submit', function (e) {
    e.preventDefault();
    var a = $('kaddr').value.trim(), out = $('kbal');
    out.className = 'dstatus'; out.textContent = 'Reading…';
    N.batch([['get_token_balance', { network: NET, token: CA, address: a }]]).then(function (r) {
      if (!r[0].ok) { out.className = 'dstatus err'; out.textContent = r[0].error; return; }
      var b = Number(r[0].data.balance);
      out.className = 'dstatus ok'; out.textContent = N.short(a) + ' holds ' + tokens(b) + ' NERBY' + (state.price ? ' (≈ ' + usd(b * state.price) + ')' : '') + ', ' + (b / SUPPLY * 100).toFixed(4) + '% of supply';
    });
  });

  // ---------- start ----------
  bs('/addresses/' + CA).then(function (j) { if (j.creator_address_hash) state.deployer = j.creator_address_hash.toLowerCase(); }).catch(function () {}).then(function () {
    return market();
  }).then(function () { chain(); holders(); });
  setInterval(function () { if (last) set('kago', Math.round((Date.now() - last) / 1000) + 's ago'); }, 1000);
  setInterval(function () { if (!document.hidden) chain(); }, 20000);
  setInterval(function () { if (!document.hidden) market(); }, 60000);
})();

/* share card: fresh link per share so X shows today's numbers */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('shx')) return;
  var link = function () { return 'https://www.nerbyprotocol.xyz/s/nerby?v=' + Math.floor(Date.now() / 600000).toString(36); };
  var text = function () {
    var p = ($('mprice') || {}).textContent, b = ($('kburn') || {}).textContent, pct = ($('kpct') || {}).textContent;
    var parts = ['$NERBY live on Robinhood Chain 🪐'];
    if (p && p !== '…') parts.push('Price ' + p);
    if (b && b !== '…') parts.push('🔥 ' + b + ' NERBY burned' + (pct && pct !== '…' ? ' (' + pct + ')' : ''));
    return parts.join('\n');
  };
  $('shx').addEventListener('click', function (e) { e.preventDefault(); window.open('https://x.com/intent/post?text=' + encodeURIComponent(text()) + '&url=' + encodeURIComponent(link()), '_blank', 'noopener'); });
  $('shtg').addEventListener('click', function (e) { e.preventDefault(); window.open('https://t.me/share/url?url=' + encodeURIComponent(link()) + '&text=' + encodeURIComponent(text()), '_blank', 'noopener'); });
  $('shcopy').addEventListener('click', function () {
    var l = link(), b = $('shcopy').querySelector('b');
    if (navigator.clipboard) navigator.clipboard.writeText(l).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy link'; }, 1600); });
  });
  // keep the preview image in step with the numbers on the page
  setInterval(function () { if (!document.hidden) $('shimg').src = '/api/og?t=' + Math.floor(Date.now() / 300000); }, 300000);
})();
