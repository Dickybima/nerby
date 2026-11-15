/* Nerby Protocol — Explore: look up any address or transaction, live from the chain. */
(function () {
  'use strict';
  var N = window.Nerby, $ = function (id) { return document.getElementById(id); };
  var networks = [], TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  var netOf = function (id) { return networks.filter(function (n) { return n.id === id; })[0]; };
  var seq = 0;

  function say(msg, kind) { var s = $('xstatus'); s.className = 'dstatus ' + (kind || ''); s.textContent = msg || ''; }
  function clear() { $('xout').textContent = ''; }
  function section(title) {
    var s = N.el('section', 'xsec'); s.appendChild(N.el('h3', '', title));
    var g = N.el('div', 'tiles'); s.appendChild(g); $('xout').appendChild(s);
    return g;
  }
  function addrLink(net, a, label) { return N.link('explore.html#' + net.id + '/' + a, label || a, 'mono'); }
  function ext(net, path, text) { return N.link(net.explorer + path, text); }

  function run() {
    var q = $('xq').value.trim(), net = netOf($('xnet').value), mine = ++seq;
    clear();
    if (!q) return say('Paste an address or a transaction hash.');
    if (/^0x[0-9a-fA-F]{64}$/.test(q)) return tx(net, q, mine);
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) return addr(net, q, mine);
    say('That is not an address (0x + 40 characters) or a transaction hash (0x + 64 characters).', 'err');
  }

  function addr(net, a, mine) {
    history.replaceState(null, '', '#' + net.id + '/' + a);
    say('Reading ' + net.name + '…');
    var call = function (fn, args) { return ['call_contract', { network: net.id, address: a, function: fn, args: args || [] }]; };
    N.batch([
      ['get_code', { network: net.id, address: a }],
      ['get_balance', { network: net.id, address: a }],
      call('name() view returns (string)'), call('symbol() view returns (string)'), call('decimals() view returns (uint8)'), call('totalSupply() view returns (uint256)'),
      call('balanceOf(address) view returns (uint256)', [N.DEAD]), call('balanceOf(address) view returns (uint256)', [N.ZERO]),
      call('owner() view returns (address)'),
      ['get_contract_source', { network: net.id, address: a }]
    ]).then(function (r) {
      if (mine !== seq) return;
      if (!r[0].ok) return say(r[0].error, 'err');
      say('');
      var code = r[0].data, isToken = r[3].ok && r[4].ok && r[5].ok;
      // an EIP-7702 wallet carries a 23-byte delegation marker, but it is still a wallet
      var delegated = code.bytecodeBytes === 23 && /^0xef0100/i.test(code.bytecode || '');
      if (delegated) code.isContract = false;
      var g = section(code.isContract ? (isToken ? 'Token' : 'Contract') : 'Wallet');
      g.appendChild(N.tile('Address', ext(net, '/address/' + a, a), net.name, 'wide'));
      if (r[1].ok) g.appendChild(N.tile('Native balance', N.trimNum(r[1].data.balance) + ' ' + r[1].data.symbol));
      if (!code.isContract) {
        g.appendChild(N.tile('Type', 'Wallet', delegated ? 'A wallet that delegates to a smart account (EIP-7702)' : 'No contract code at this address'));
        tokenCheck(net, a);
        return;
      }
      g.appendChild(N.tile('Bytecode', code.bytecodeBytes.toLocaleString() + ' bytes'));
      if (isToken) {
        var dec = Number(r[4].data.result), supply = r[5].data.result, sym = r[3].data.result;
        var burned = BigInt(r[6].ok ? r[6].data.result : 0) + BigInt(r[7].ok ? r[7].data.result : 0);
        var t = section((r[2].ok ? r[2].data.result : 'Token') + ' (' + sym + ')');
        t.appendChild(N.tile('Total supply', N.units(supply, dec, 2) + ' ' + sym, dec + ' decimals'));
        t.appendChild(N.tile('Sent to burn addresses', N.units(burned.toString(), dec, 2) + ' ' + sym, N.percent(burned.toString(), supply) + '% of supply', burned > 0n ? 'hot' : ''));
        t.appendChild(N.tile('Not burned', N.units((BigInt(supply) - burned).toString(), dec, 2) + ' ' + sym));
        if (r[8].ok) {
          var o = r[8].data.result;
          t.appendChild(N.tile('Owner', /^0x0{40}$/.test(o) ? 'Renounced' : addrLink(net, o, N.short(o)), /^0x0{40}$/.test(o) ? 'Ownership was given up' : 'This address has owner rights'));
        } else t.appendChild(N.tile('Owner', 'None', 'The contract has no owner() function'));
      }
      var sfs = N.el('section', 'xsec'); sfs.appendChild(N.el('h3', '', 'Safety check'));
      var sfb = N.el('div', 'sf'); sfb.appendChild(N.el('p', 'dstatus', 'Checking for admin powers…')); sfs.appendChild(sfb); $('xout').appendChild(sfs);
      N.batch([['check_token_safety', { network: net.id, address: a }]]).then(function (q) {
        if (mine !== seq) return;
        if (q[0].ok && q[0].data.checks) N.safety(sfb, q[0].data); else sfb.textContent = 'The safety check could not run for this contract.';
      });
      var s = section('Source code');
      if (r[9].ok && r[9].data.verified) {
        var v = r[9].data;
        s.appendChild(N.tile('Verified', 'Yes · ' + v.via, (v.name || '') + (v.compiler ? ' · solc ' + v.compiler : ''), 'ok'));
        if (v.proxyImplementations) s.appendChild(N.tile('Proxy', addrLink(net, v.proxyImplementations[0], N.short(v.proxyImplementations[0])), 'The logic lives at this address'));
        var fn = N.el('div', 'tile wide'); fn.appendChild(N.el('span', '', 'Functions (' + v.functions.length + ')'));
        var pre = N.el('pre', 'fns', v.functions.join('\n')); fn.appendChild(pre); s.appendChild(fn);
      } else {
        s.appendChild(N.tile('Verified', 'No', 'No verified source on Sourcify or Blockscout, so the code cannot be read', 'warn'));
      }
    }).catch(function () { if (mine === seq) say('Could not reach the Nerby Protocol server. Try again.', 'err'); });
  }

  // wallet view: let the visitor check a token balance
  function tokenCheck(net, wallet) {
    var s = N.el('section', 'xsec'); s.appendChild(N.el('h3', '', 'Check a token balance'));
    var f = N.el('form', 'xrow'), i = N.el('input'), b = N.el('button', 'btn l br'), out = N.el('div', 'tiles');
    i.type = 'text'; i.placeholder = 'Token contract address (0x…)'; i.spellcheck = false;
    if (net.id === 'robinhood') i.value = '0xd17d0eabf76f2b3144da726efd341761f4697113';
    b.type = 'submit'; b.appendChild(N.el('b', '', 'Check'));
    f.appendChild(i); f.appendChild(b); s.appendChild(f); s.appendChild(out); $('xout').appendChild(s);
    var go = function (e) {
      if (e) e.preventDefault();
      out.textContent = '';
      N.batch([['get_token_balance', { network: net.id, token: i.value.trim(), address: wallet }]]).then(function (r) {
        out.appendChild(r[0].ok ? N.tile('Balance', N.trimNum(r[0].data.balance, 4) + ' ' + (r[0].data.symbol || ''), 'Token ' + N.short(r[0].data.token)) : N.tile('Balance', 'Not available', r[0].error, 'warn'));
      });
    };
    f.addEventListener('submit', go);
    if (i.value) go();
  }

  function tx(net, h, mine) {
    history.replaceState(null, '', '#' + net.id + '/' + h);
    say('Reading ' + net.name + '…');
    N.batch([['get_transaction', { network: net.id, hash: h }]]).then(function (r) {
      if (mine !== seq) return;
      if (!r[0].ok) return say(r[0].error + ' Check that the network is right.', 'err');
      say('');
      var t = r[0].data, g = section('Transaction');
      g.appendChild(N.tile('Hash', ext(net, '/tx/' + h, h), net.name, 'wide'));
      g.appendChild(N.tile('Status', t.status === 'success' ? 'Success' : t.status === 'reverted' ? 'Reverted' : 'Pending', t.blockNumber ? 'Block ' + t.blockNumber.toLocaleString() : '', t.status === 'success' ? 'ok' : t.status === 'reverted' ? 'warn' : ''));
      g.appendChild(N.tile('From', addrLink(net, t.from, N.short(t.from))));
      g.appendChild(N.tile('To', t.to ? addrLink(net, t.to, N.short(t.to)) : 'Contract creation', t.contractCreated ? 'Created ' + N.short(t.contractCreated) : ''));
      g.appendChild(N.tile('Value', N.trimNum(t.value) + ' ' + t.symbol));
      if (t.fee) g.appendChild(N.tile('Fee', N.trimNum(t.fee, 9) + ' ' + t.symbol, Number(t.gasUsed).toLocaleString() + ' gas'));
      var moves = (t.logs || []).filter(function (l) { return l.topics[0] === TRANSFER && l.topics.length === 3; }).slice(0, 8);
      if (!moves.length) return;
      var tokens = moves.map(function (l) { return l.address; }).filter(function (a, i, all) { return all.indexOf(a) === i; });
      var calls = [];
      tokens.forEach(function (a) {
        calls.push(['call_contract', { network: net.id, address: a, function: 'symbol() view returns (string)' }]);
        calls.push(['call_contract', { network: net.id, address: a, function: 'decimals() view returns (uint8)' }]);
      });
      N.batch(calls).then(function (m) {
        if (mine !== seq) return;
        var s = section('Token transfers' + (t.logCount > t.logs.length ? ' (first ' + moves.length + ')' : ''));
        moves.forEach(function (l) {
          var k = tokens.indexOf(l.address) * 2, sym = m[k].ok ? m[k].data.result : N.short(l.address), dec = m[k + 1].ok ? Number(m[k + 1].data.result) : 18;
          var from = '0x' + l.topics[1].slice(26), to = '0x' + l.topics[2].slice(26), row = N.el('span');
          row.appendChild(addrLink(net, from, N.short(from))); row.appendChild(document.createTextNode('  →  ')); row.appendChild(addrLink(net, to, N.short(to)));
          s.appendChild(N.tile(sym, N.units(BigInt(l.data === '0x' ? 0 : l.data).toString(), dec, 4), row, /dead$/i.test(to) || /^0x0{40}$/.test(to) ? 'hot' : ''));
        });
      });
    }).catch(function () { if (mine === seq) say('Could not reach the Nerby Protocol server. Try again.', 'err'); });
  }

  function fromHash() {
    var m = /^#([a-z]+)\/(0x[0-9a-fA-F]{40,64})$/.exec(location.hash);
    if (!m || !netOf(m[1])) return false;
    $('xnet').value = m[1]; $('xq').value = m[2];
    run();
    return true;
  }

  $('xform').addEventListener('submit', function (e) { e.preventDefault(); run(); });
  [].forEach.call(document.querySelectorAll('[data-try]'), function (b) {
    b.addEventListener('click', function () { var p = b.getAttribute('data-try').split('/'); $('xnet').value = p[0]; $('xq').value = p[1]; run(); });
  });
  window.addEventListener('hashchange', fromHash);

  N.batch([['list_networks', {}]]).then(function (r) {
    networks = r[0].data;
    networks.forEach(function (n) { var o = N.el('option', '', n.name); o.value = n.id; $('xnet').appendChild(o); });
    if (!fromHash()) say('Paste an address or a transaction hash, or try one of the examples.');
  }).catch(function () { say('Could not reach the Nerby Protocol server. Reload the page to try again.', 'err'); });
})();
