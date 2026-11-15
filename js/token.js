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
