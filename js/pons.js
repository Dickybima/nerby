/* Nerby Protocol — Top Pons tokens on Robinhood Chain. */
(function () {
  'use strict';
  var N = window.Nerby, $ = function (id) { return document.getElementById(id); };
  var NERBY = '0xd17d0eabf76f2b3144da726efd341761f4697113';
  var all = [], filter = 'all', sort = 'volume', query = '';

  function usd(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K';
    return '$' + v.toFixed(0);
  }
  function price(p) {
    if (!p) return '—';
    if (p >= 1) return '$' + p.toFixed(2);
    if (p >= 0.01) return '$' + p.toFixed(4);
    return '$' + p.toFixed(Math.max(0, -Math.floor(Math.log10(p)) - 1) + 3);
  }
  function age(iso) {
    var h = (Date.now() - new Date(iso).getTime()) / 3600000;
    return h < 1 ? Math.max(1, Math.round(h * 60)) + 'm' : h < 48 ? Math.round(h) + 'h' : Math.round(h / 24) + 'd';
  }
  var STAGE = { curve: 'On curve', graduated: 'Graduated', pons: 'Pons pool' };

  function row(t) {
    var r = N.el('div', 'prow' + (t.address === NERBY ? ' me' : ''));
    r.appendChild(N.el('span', 'tpk', '#' + t.rank));
    var who = N.el('div', 'tpw');
    if (t.image) { var img = N.el('img'); img.src = t.image; img.alt = ''; img.loading = 'lazy'; img.width = 32; img.height = 32; img.onerror = function () { img.replaceWith(N.el('i', 'tpph')); }; who.appendChild(img); } else who.appendChild(N.el('i', 'tpph'));
    var nm = N.el('div'); nm.appendChild(N.el('b', '', t.name)); nm.appendChild(N.el('small', '', '$' + t.symbol + ' · ' + age(t.createdAt)));
    who.appendChild(nm); r.appendChild(who);
    r.appendChild(N.el('span', 'tpp', price(t.priceUsd)));
    r.appendChild(N.el('span', 'tpc ' + ((t.change24h || 0) >= 0 ? 'up' : 'down'), t.change24h === null || t.change24h === undefined ? '—' : ((t.change24h >= 0 ? '+' : '') + t.change24h.toFixed(1) + '%')));
    r.appendChild(N.el('span', 'tpv', usd(t.volume24h)));
    r.appendChild(N.el('span', 'tpf', usd(t.marketCapUsd || t.fdvUsd)));
    r.appendChild(N.el('span', 'tpl', usd(t.liquidityUsd)));
    var st = N.el('span', 'tps ' + t.stage);
    st.appendChild(N.el('b', '', STAGE[t.stage] || t.stage));
    if (t.stage === 'curve' && t.graduationPercent !== undefined) {
      var bar = N.el('i', 'tpbar'), fill = N.el('i'); fill.style.width = t.graduationPercent + '%'; bar.appendChild(fill); st.appendChild(bar);
      st.appendChild(N.el('small', '', t.graduationPercent.toFixed(0) + '% to graduation'));
    }
    r.appendChild(st);
    var act = N.el('span', 'tpa');
    act.appendChild(N.link('explore.html#robinhood/' + t.address, 'Scan'));
    act.appendChild(N.link(t.chart, 'Chart'));
    if (t.address === NERBY) act.appendChild(N.link('terminal.html', 'Trade'));
    r.appendChild(act);
    return r;
  }

  function render() {
    var list = all.filter(function (t) {
      if (filter === '250k' && (t.marketCapUsd || t.fdvUsd || 0) < 250000) return false;
      if (filter === 'curve' && t.stage !== 'curve') return false;
      if (filter === 'graduated' && t.stage === 'curve') return false;
      if (query && (t.name + ' ' + t.symbol + ' ' + t.address).toLowerCase().indexOf(query) < 0) return false;
      return true;
    });
    var key = { volume: function (t) { return t.volume24h; }, mcap: function (t) { return t.marketCapUsd || t.fdvUsd || 0; }, change: function (t) { return t.change24h || -1e9; }, new: function (t) { return new Date(t.createdAt).getTime(); } }[sort];
    list = list.slice().sort(function (a, b) { return key(b) - key(a); });
    var box = $('plist'); box.textContent = '';
    if (!list.length) { box.appendChild(N.el('p', 'dstatus', 'No tokens match this filter.')); return; }
    list.forEach(function (t) { box.appendChild(row(t)); });
    var top = all.slice(0, 3);
    var podium = $('ppod'); podium.textContent = '';
    ['👑', '🥈', '🥉'].forEach(function (m, i) {
      var t = top[i]; if (!t) return;
      var c = N.el('a', 'pod'); c.href = 'explore.html#robinhood/' + t.address;
      c.appendChild(N.el('span', 'pmd', m));
      if (t.image) { var img = N.el('img'); img.src = t.image; img.alt = ''; img.onerror = function () { img.remove(); }; c.appendChild(img); }
      c.appendChild(N.el('b', '', t.name));
      c.appendChild(N.el('small', '', '$' + t.symbol + ' · ' + usd(t.volume24h) + ' volume'));
      podium.appendChild(c);
    });
  }

  function nerbyCard(d) {
    var t = all.filter(function (x) { return x.address === NERBY; })[0];
    var box = $('pme'); box.textContent = '';
    box.appendChild(N.el('b', '', '$NERBY'));
    if (t) box.appendChild(N.el('span', '', 'Rank #' + t.rank + ' of ' + all.length + ' by 24h volume · ' + usd(t.volume24h) + ' volume' + (t.graduationPercent !== undefined ? ' · ' + t.graduationPercent.toFixed(0) + '% to graduation' : '')));
    else box.appendChild(N.el('span', '', 'Outside today’s top ' + all.length + ' by volume. Every buy moves it up.'));
    var a = N.el('div', 'pmea'); a.appendChild(N.link('token.html', 'Live page')); a.appendChild(N.link('terminal.html', 'Buy in Terminal')); box.appendChild(a);
  }

  function load() {
    fetch('/api/pons').then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) throw new Error(d.error);
      all = d.tokens;
      $('pupd').textContent = (d.stale ? 'Delayed · ' : '') + 'Updated ' + new Date(d.updatedAt).toLocaleTimeString() + ' · data from GeckoTerminal and Robinhood Chain';
      nerbyCard(d); render();
    }).catch(function (e) { $('pupd').textContent = 'Could not load Pons data right now. It refreshes on its own; try again in a minute.'; });
  }

  [].forEach.call(document.querySelectorAll('[data-pf]'), function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-pf');
      [].forEach.call(document.querySelectorAll('[data-pf]'), function (x) { x.classList.toggle('on', x === b); });
      render();
    });
  });
  $('psort').addEventListener('change', function () { sort = this.value; render(); });
  $('pq').addEventListener('input', function () { query = this.value.trim().toLowerCase(); render(); });
  load();
  setInterval(function () { if (!document.hidden) load(); }, 120000);
})();
