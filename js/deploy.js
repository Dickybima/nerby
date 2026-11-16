/* Nerby Protocol — deploy page. Compiles on the server, signs in the visitor's own wallet. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var networks = [], account = null, prepared = null, tab = 'erc20';

  function mcp(name, args) {
    return fetch('/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: name, arguments: args } })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error.message);
      var text = j.result.content[0].text;
      if (j.result.isError) throw new Error(text);
      return JSON.parse(text);
    });
  }

  function status(msg, kind) {
    var el = $('dstatus');
    el.className = 'dstatus ' + (kind || '');
    el.textContent = '';
    if (typeof msg === 'string') el.textContent = msg; else if (msg) el.appendChild(msg);
  }
  function link(href, text) {
    var a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text;
    return a;
  }
  function line() {
    var p = document.createElement('span');
    for (var i = 0; i < arguments.length; i++) p.appendChild(typeof arguments[i] === 'string' ? document.createTextNode(arguments[i]) : arguments[i]);
    return p;
  }
  var short = function (a) { return a.slice(0, 6) + '…' + a.slice(-4); };
  var netOf = function (id) { return networks.filter(function (n) { return n.id === id; })[0]; };

  // ----- recipe links: #r=<deflated json, base64url>.<checksum> -----
  function readRecipe() {
    var m = /[#&]r=([A-Za-z0-9_-]+)\.([0-9a-f]{8})/.exec(location.hash);
    if (!m) return Promise.resolve(null);
    var bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text().then(function (json) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)).then(function (d) {
        var hex = [].map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        if (hex.slice(0, 8) !== m[2]) throw new Error('checksum');
        return JSON.parse(json);
      });
    });
  }

  function setTab(t) {
    tab = t;
    [].forEach.call(document.querySelectorAll('.dtab'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === t); });
    $('f-erc20').hidden = t !== 'erc20';
    $('f-source').hidden = t !== 'source';
    invalidate();
  }

  function invalidate() {
    prepared = null;
    $('review').hidden = true;
    $('bdeploy').disabled = true;
  }

  function formArgs() {
    var a = { network: $('network').value, from: account, includeData: true };
    if (tab === 'erc20') {
      a.template = 'erc20';
      a.params = { name: $('tname').value, symbol: $('tsymbol').value, supply: $('tsupply').value, burnable: $('tburn').checked, mintable: $('tmint').checked };
    } else {
      a.source = $('source').value;
      if ($('cname').value.trim()) a.contractName = $('cname').value.trim();
      var raw = $('cargs').value.trim();
      if (raw) {
        try { a.constructorArgs = JSON.parse(raw); } catch (e) { throw new Error('Constructor arguments must be a JSON array, for example ["1000", "0xabc…"].'); }
        if (!Array.isArray(a.constructorArgs)) throw new Error('Constructor arguments must be a JSON array.');
      }
    }
    return a;
  }

  function row(k, v) {
    var tr = document.createElement('div'); tr.className = 'drow';
    var a = document.createElement('span'); a.textContent = k;
    var b = document.createElement('b');
    if (typeof v === 'string') b.textContent = v; else b.appendChild(v);
    tr.appendChild(a); tr.appendChild(b);
    return tr;
  }

  var W = window.NerbyWallet;
  function connect() {
    return W.pick().then(function (a) { setAccount(a); return account; }, function () { status('No wallet chosen.', ''); return null; });
  }
  function setAccount(a) {
    account = a || null;
    $('bconnect').textContent = account ? (W.name() || 'Wallet') + ' · ' + short(account) : 'Connect wallet';
    invalidate();
  }

  function review() {
    status('');
    (account ? Promise.resolve(account) : connect()).then(function (acc) {
      if (!acc) return;
      var args;
      try { args = formArgs(); } catch (e) { return status(e.message, 'err'); }
      $('breview').disabled = true;
      status('Compiling and estimating gas…');
      return mcp('prepare_deployment', args).then(function (d) {
        var n = netOf(args.network), box = $('rows');
        box.textContent = '';
        box.appendChild(row('Contract', d.contract));
        box.appendChild(row('Network', n.name + ' · chain ID ' + n.chainId));
        box.appendChild(row('Deployer', link(n.explorer + '/address/' + d.from, d.from)));
        box.appendChild(row('Bytecode', d.bytecodeBytes.toLocaleString() + ' bytes'));
        if (d.wouldSucceed) {
          box.appendChild(row('Will be created at', d.predictedAddress));
          box.appendChild(row('Estimated fee', d.estimatedFee + ' (' + Number(d.gasEstimate).toLocaleString() + ' gas at ' + d.gasPriceGwei + ' gwei)'));
          box.appendChild(row('Your balance', d.balance));
        }
        $('rsrc').textContent = tab === 'erc20' ? d.source : args.source;
        $('rwarn').hidden = !(d.warnings && d.warnings.length);
        $('rwarn').textContent = d.warnings && d.warnings.length ? 'Compiler warnings:\n\n' + d.warnings.join('\n\n') : '';
        $('review').hidden = false;
        if (!d.wouldSucceed) { status('This deployment would fail: ' + d.revertReason, 'err'); return; }
        if (!d.enoughBalance) { status('This wallet does not hold enough ' + n.name + ' gas to pay the fee.', 'err'); return; }
        prepared = { args: args, d: d, net: n };
        $('bdeploy').disabled = false;
        status('Ready. Check the details and the source, then deploy. Your wallet will ask you to confirm.');
      }).catch(function (e) { status(e.message, 'err'); }).then(function () { $('breview').disabled = false; });
    });
  }

  function ensureChain(n) {
    var hex = '0x' + n.chainId.toString(16);
    return W.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }).catch(function (e) {
      if (e.code !== 4902 && !/unrecognized|not been added|unknown chain/i.test(e.message || '')) throw e;
      return W.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, chainName: n.name, nativeCurrency: { name: n.nativeCurrency, symbol: n.nativeCurrency, decimals: 18 }, rpcUrls: [n.publicRpc], blockExplorerUrls: [n.explorer] }]
      });
    });
  }

  function deploy() {
    if (!prepared) return;
    var p = prepared, tx = p.d.unsignedTransaction;
    $('bdeploy').disabled = true;
    status('Confirm the network and the transaction in your wallet…');
    ensureChain(p.net).then(function () {
      return W.request({ method: 'eth_sendTransaction', params: [{ from: p.d.from, data: tx.data, gas: tx.gas, value: '0x0' }] });
    }).then(function (hash) {
      prepared = null;
      status(line('Sent. Waiting for confirmation… ', link(p.net.explorer + '/tx/' + hash, short(hash))));
      var tries = 0;
      (function poll() {
        mcp('get_transaction', { network: p.args.network, hash: hash }).then(function (t) {
          if (t.status === 'success') return status(line('Deployed at ', link(p.net.explorer + '/address/' + t.contractCreated, t.contractCreated), '. Save this address.'), 'ok');
          if (t.status === 'reverted') return status(line('The deployment transaction reverted. ', link(p.net.explorer + '/tx/' + hash, 'View transaction')), 'err');
          throw new Error('pending');
        }).catch(function () {
          if (++tries > 60) return status(line('Still not confirmed. Check it on the explorer: ', link(p.net.explorer + '/tx/' + hash, short(hash))));
          setTimeout(poll, 3000);
        });
      })();
    }).catch(function (e) {
      $('bdeploy').disabled = false;
      status(e.code === 4001 ? 'You declined the request in the wallet. Nothing was sent.' : 'The wallet returned an error: ' + (e.message || e), 'err');
    });
  }

  // ----- wire up -----
  [].forEach.call(document.querySelectorAll('.dtab'), function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
  $('dform').addEventListener('input', invalidate);
  $('dform').addEventListener('submit', function (e) { e.preventDefault(); review(); });
  $('bconnect').addEventListener('click', connect);
  $('bdeploy').addEventListener('click', deploy);
  W.onChange(function (a) { if ((a || null) !== account) setAccount(a); });
  W.restore();

  mcp('list_networks', {}).then(function (list) {
    networks = list;
    networks = list = list.filter(function (n) { return n.type !== 'solana'; }); // deployments are EVM only
    list.forEach(function (n) { var o = document.createElement('option'); o.value = n.id; o.textContent = n.name; $('network').appendChild(o); });
    return readRecipe().catch(function () { status('This deploy link is damaged, so nothing was filled in. Ask your AI for the link again, or fill in the form yourself.', 'err'); return null; });
  }).then(function (r) {
    if (!r) return;
    if (netOf(r.n)) $('network').value = r.n;
    if (r.t === 'erc20' && r.p) {
      $('tname').value = r.p.name; $('tsymbol').value = r.p.symbol; $('tsupply').value = r.p.supply;
      $('tburn').checked = !!r.p.burnable; $('tmint').checked = !!r.p.mintable;
      setTab('erc20');
    } else if (r.t === 'source') {
      $('source').value = r.s || ''; $('cname').value = r.c || ''; $('cargs').value = r.a ? JSON.stringify(r.a) : '';
      setTab('source');
    }
    status('Filled in from your link. Connect your wallet and review before deploying.');
  }).catch(function () { status('Could not reach the Nerby Protocol server. Reload the page to try again.', 'err'); });
})();
