/* Nerby Protocol — network status: asks every network for its latest block and times the answer. */
(function () {
  'use strict';
  var N = window.Nerby, $ = function (id) { return document.getElementById(id); };
  var rows = {}, networks = [];

  function one(n) {
    var t = performance.now();
    return N.batch([['get_block', { network: n.id }]]).then(function (r) {
      var ms = Math.round(performance.now() - t), row = rows[n.id];
      if (!r[0].ok) { set(row, 'down', '—', '—', ms, r[0].error); return false; }
      var b = r[0].data, age = Math.max(0, Math.round((Date.now() - new Date(b.timestamp).getTime()) / 1000));
      set(row, age > 300 ? 'slow' : 'up', b.number.toLocaleString(), age < 120 ? age + 's ago' : Math.round(age / 60) + 'm ago', ms, age > 300 ? 'Latest block is old' : 'Operational');
      return true;
    }).catch(function () { set(rows[n.id], 'down', '—', '—', null, 'No answer'); return false; });
  }
  function set(row, state, block, age, ms, note) {
    row.className = 'srow ' + state;
    row.querySelector('.sb').textContent = block;
    row.querySelector('.sa').textContent = age;
    row.querySelector('.sm').textContent = ms === null ? '—' : ms + ' ms';
    row.querySelector('.sn').textContent = note;
  }

  function all() {
    $('sstamp').textContent = 'Checking…';
    Promise.all(networks.map(one)).then(function (ok) {
      var up = ok.filter(Boolean).length;
      $('ssum').className = 'shero ' + (up === networks.length ? 'up' : up ? 'slow' : 'down');
      $('ssumt').textContent = up === networks.length ? 'All systems operational' : up ? up + ' of ' + networks.length + ' networks answering' : 'The gateway is not answering';
      $('sstamp').textContent = 'Checked ' + new Date().toLocaleTimeString() + ' · refreshes every 30 seconds';
    });
  }

  var t = performance.now();
  N.batch([['list_networks', {}]]).then(function (r) {
    $('sapi').textContent = Math.round(performance.now() - t) + ' ms';
    networks = r[0].data;
    networks.forEach(function (n) {
      var row = N.el('div', 'srow');
      row.appendChild(N.el('i'));
      var nm = N.el('div', 'sname'); nm.appendChild(N.el('b', '', n.name)); nm.appendChild(N.el('small', '', 'Chain ID ' + n.chainId)); row.appendChild(nm);
      ['sb', 'sa', 'sm', 'sn'].forEach(function (c) { row.appendChild(N.el('span', c, '…')); });
      rows[n.id] = row; $('slist').appendChild(row);
    });
    all();
    setInterval(function () { if (!document.hidden) all(); }, 30000);
  }).catch(function () {
    $('ssum').className = 'shero down'; $('ssumt').textContent = 'The gateway is not answering'; $('sstamp').textContent = 'Reload the page to try again.';
  });
})();
