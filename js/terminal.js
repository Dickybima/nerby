/* Nerby Protocol — Terminal. Type a command, review the preview, sign in your own wallet.
   Trades go straight to the $NERBY bonding curve on Pons V2 (Robinhood Chain). Nerby adds no fee
   and never holds keys: every transaction is built here and signed by the visitor's wallet. */
(function () {
  'use strict';
  var N = window.Nerby, $ = function (id) { return document.getElementById(id); };
  var CHAIN = 4663, NET = 'robinhood', EXPLORER = 'https://robinhoodchain.blockscout.com';
  var TOKEN = '0xd17d0eabf76f2b3144da726efd341761f4697113', CURVE = '0xc6724f498424a7df496f594ddea382ebc1c5906c';
  var DEAD = '0x000000000000000000000000000000000000dEaD', E18 = 10n ** 18n, BPS = 10000n;
  var SEL = { buy: '0x59a87bc1', sell: '0xd04c6983', approve: '0x095ea7b3', transfer: '0xa9059cbb' };
  var account = null, slippage = 2, pending = null, busy = false, history = [], hpos = 0;

  // ---------- output ----------
  var out = $('tout');
  function line(text, cls) {
    var p = N.el('div', 'tl ' + (cls || ''));
    if (typeof text === 'string') p.textContent = text; else p.appendChild(text);
    out.appendChild(p); out.scrollTop = out.scrollHeight;
    return p;
  }
  function frag() { var f = N.el('span'); for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; f.appendChild(typeof a === 'string' ? document.createTextNode(a) : a); } return f; }
  function txLink(h) { return N.link(EXPLORER + '/tx/' + h, N.short(h)); }
  function card(rows, title) {
    var c = N.el('div', 'tcard');
    if (title) c.appendChild(N.el('b', '', title));
    rows.forEach(function (r) { var d = N.el('div', 'trw'); d.appendChild(N.el('span', '', r[0])); var v = N.el('em', r[2] || ''); if (typeof r[1] === 'string') v.textContent = r[1]; else v.appendChild(r[1]); d.appendChild(v); c.appendChild(d); });
    return line(c, 'raw');
  }

  // ---------- numbers ----------
  function parseUnits(s) {
    var m = /^(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[1] === '' && !m[2])) return null;
    var frac = (m[2] || '').slice(0, 18).padEnd(18, '0');
    return BigInt(m[1] || '0') * E18 + BigInt(frac);
  }
  // "1.5m", "250k", "1,000,000", "0.01" → wei; "50%", "all", "max" → fraction of a balance
  function amount(s) {
    s = String(s).toLowerCase().replace(/,/g, '');
    if (s === 'all' || s === 'max') return { pct: 100 };
    var p = /^(\d+(?:\.\d+)?)%$/.exec(s);
    if (p) { var v = Number(p[1]); return v > 0 && v <= 100 ? { pct: v } : null; }
    var m = /^(\d*\.?\d+)([kmb])?$/.exec(s);
    if (!m) return null;
    var mult = { k: 3, m: 6, b: 9 }[m[2]] || 0, w = parseUnits(m[1]);
    return w === null ? null : { wei: w * 10n ** BigInt(mult) };
  }
  function fmt(wei, max) { return N.units(wei.toString(), 18, max === undefined ? 4 : max); }
  var hex = function (v) { return '0x' + BigInt(v).toString(16); };
  var word = function (v) { return BigInt(v).toString(16).padStart(64, '0'); };
  var addr = function (a) { return a.toLowerCase().replace(/^0x/, '').padStart(64, '0'); };
  var isAddr = function (a) { return /^0x[0-9a-fA-F]{40}$/.test(a); };

  // ---------- chain reads (through the Nerby endpoint, no wallet needed) ----------
  function call(to, fn, args) { return ['call_contract', { network: NET, address: to, function: fn, args: args || [] }]; }
  function curveState(who) {
    return N.batchRetry([
      call(CURVE, 'getReserves() view returns (uint256,uint256)'), call(CURVE, 'feeBps() view returns (uint256)'),
      call(CURVE, 'creatorTaxBps() view returns (uint256)'), call(CURVE, 'graduated() view returns (bool)'),
      call(CURVE, 'readyToGraduate() view returns (bool)'), call(CURVE, 'sellableTokens() view returns (uint256)'),
      call(CURVE, 'currentSnipeTaxBps(address) view returns (uint256)', [who || DEAD])
    ]).then(function (r) {
      if (!r.every(function (x) { return x.ok; })) throw new Error('Could not read the $NERBY curve. Try again.');
      return {
        quote: BigInt(r[0].data.result[0]), tokens: BigInt(r[0].data.result[1]), fee: BigInt(r[1].data.result), tax: BigInt(r[2].data.result),
        closed: r[3].data.result || r[4].data.result, sellable: BigInt(r[5].data.result), snipe: BigInt(r[6].data.result)
      };
    });
  }
  function balances(who) {
    return N.batchRetry([['get_balance', { network: NET, address: who }], call(TOKEN, 'balanceOf(address) view returns (uint256)', [who])]).then(function (r) {
      if (!r[0].ok || !r[1].ok) throw new Error('Could not read balances.');
      return { eth: BigInt(r[0].data.wei), nerby: BigInt(r[1].data.result) };
    });
  }
  // same integer maths as PonsV2BondingCurveMath with a zero fee
  var amountOut = function (i, ri, ro) { return i * BPS * ro / (ri * BPS + i * BPS); };
  var amountIn = function (o, ri, ro) { return (ri * o * BPS + (ro - o) * BPS - 1n) / ((ro - o) * BPS) + 1n; };

  // ---------- wallet ----------
  function wallet() {
    if (!window.ethereum) throw new Error('No wallet found. Open this page in a browser with MetaMask, Rabby or another wallet, or in your wallet app’s browser.');
    return window.ethereum;
  }
  function connect() {
    return wallet().request({ method: 'eth_requestAccounts' }).then(function (a) { setAccount(a[0]); return account; });
  }
  function setAccount(a) {
    account = a ? a.toLowerCase() : null;
    $('twallet').textContent = account ? N.short(account) : 'Not connected';
    $('tconnect').textContent = account ? 'Connected' : 'Connect wallet';
    $('tconnect').classList.toggle('on', !!account);
    if (account) refreshBar();
  }
  function refreshBar() {
    if (!account) return;
    balances(account).then(function (b) { $('teth').textContent = fmt(b.eth, 5) + ' ETH'; $('tnerby').textContent = fmt(b.nerby, 0) + ' NERBY'; }).catch(function () {});
  }
  function ensureChain() {
    var w = wallet(), id = '0x' + CHAIN.toString(16);
    return w.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: id }] }).catch(function (e) {
      if (e.code !== 4902 && !/unrecognized|not been added|unknown chain/i.test(e.message || '')) throw e;
      return w.request({ method: 'wallet_addEthereumChain', params: [{ chainId: id, chainName: 'Robinhood Chain', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: [EXPLORER] }] });
    });
  }
  function needWallet() { return account ? Promise.resolve(account) : (line('Connecting wallet…', 'mute'), connect()); }
  function send(tx, label) {
    line(label + ' — confirm in your wallet…', 'mute');
    return ensureChain().then(function () {
      return wallet().request({ method: 'eth_sendTransaction', params: [Object.assign({ from: account }, tx)] });
    }).then(function (h) {
      var l = line(frag(label + ' sent ', txLink(h), ' · waiting for confirmation…'), 'mute');
      return receipt(h).then(function (t) {
        l.textContent = '';
        if (t.status !== 'success') { l.appendChild(frag('✗ ' + label + ' reverted ', txLink(h))); l.className = 'tl err'; throw new Error('The transaction reverted on-chain.'); }
        l.appendChild(frag('✓ ' + label + ' confirmed ', txLink(h))); l.className = 'tl ok';
        return t;
      });
    });
  }
  function receipt(h) {
    var tries = 0;
    return new Promise(function (ok, fail) {
      (function poll() {
        N.batch([['get_transaction', { network: NET, hash: h }]]).then(function (r) {
          if (r[0].ok && r[0].data.status !== 'pending') return ok(r[0].data);
          if (++tries > 80) return fail(new Error('Still not confirmed. Check it on the explorer.'));
          setTimeout(poll, 1500);
        }).catch(function () { if (++tries > 80) fail(new Error('Lost contact while waiting.')); else setTimeout(poll, 2000); });
      })();
    });
  }
  function simulate(tx) {
    return N.batch([['simulate_transaction', { network: NET, from: account, to: tx.to, value: BigInt(tx.value || 0).toString(), data: tx.data }]]).then(function (r) {
      if (!r[0].ok) throw new Error(r[0].error);
      if (!r[0].data.wouldSucceed) throw new Error('Dry-run failed: ' + r[0].data.revertReason + '. Nothing was sent.');
      return r[0].data;
    });
  }

  // ---------- commands ----------
  var HELP = [
    ['buy 0.01 eth', 'Buy $NERBY with 0.01 ETH'],
    ['buy 1m nerby', 'Buy 1,000,000 $NERBY (pays the ETH needed)'],
    ['sell 500k nerby', 'Sell an amount of $NERBY for ETH'],
    ['sell 50% nerby', 'Sell part of your $NERBY ("all" works too)'],
    ['send 1000 nerby to 0x…', 'Send $NERBY to an address'],
    ['send 0.01 eth to 0x…', 'Send ETH to an address'],
    ['burn 10k nerby', 'Send $NERBY to the burn address'],
    ['price', 'Price, fees and curve status'],
    ['balance [0x…]', 'Your balances, or any address'],
    ['slippage 2', 'Set slippage tolerance in % (now ' + slippage + '%)'],
    ['connect · clear · help', '']
  ];
  function help() {
    var c = N.el('div', 'tcard');
    c.appendChild(N.el('b', '', 'Commands'));
    HELP.forEach(function (h) { var d = N.el('div', 'trw'); var k = N.el('code', 'tcmd', h[0]); k.addEventListener('click', function () { $('tin').value = h[0].replace(/ \[.*\]|…/g, ''); $('tin').focus(); }); d.appendChild(k); d.appendChild(N.el('span', '', h[1])); c.appendChild(d); });
    line(c, 'raw');
  }

  function run(raw) {
    var s = raw.trim().replace(/\s+/g, ' '), t = s.toLowerCase().split(' ');
    if (!s) return Promise.resolve();
    if (pending && /^(y|yes|confirm)$/.test(t[0])) return confirm();
    if (pending && /^(n|no|cancel)$/.test(t[0])) { pending = null; line('Cancelled. Nothing was sent.', 'mute'); return Promise.resolve(); }
    if (!pending && /^(y|yes|n|no|confirm|cancel)$/.test(t[0])) { line('Nothing to confirm right now.', 'mute'); return Promise.resolve(); }
    if (pending) { pending = null; line('Previous preview cancelled.', 'mute'); }
    var c = t[0];
    if (c === 'help' || c === '?') return Promise.resolve(help());
    if (c === 'clear') { out.textContent = ''; return Promise.resolve(); }
    if (c === 'connect') return connect().then(function () { line('Connected ' + account, 'ok'); return cmdBalance([]); });
    if (c === 'slippage') { var v = Number(t[1]); if (!(v > 0 && v <= 50)) throw new Error('Use a number between 0.1 and 50, for example: slippage 2'); slippage = v; line('Slippage set to ' + v + '%.', 'ok'); return Promise.resolve(); }
    if (c === 'price') return cmdPrice();
    if (c === 'balance' || c === 'bal') return cmdBalance(t.slice(1));
    if (c === 'buy') return cmdBuy(t.slice(1));
    if (c === 'sell') return cmdSell(t.slice(1));
    if (c === 'send' || c === 'transfer') return cmdSend(t.slice(1), s.split(' ').slice(1));
    if (c === 'burn') return cmdBurn(t.slice(1));
    throw new Error('Unknown command "' + c + '". Type help to see what works.');
  }

  function cmdPrice() {
    return Promise.all([curveState(account), fetch('/api/market?network=' + NET + '&token=' + TOKEN).then(function (r) { return r.json(); }).catch(function () { return {}; })]).then(function (r) {
      var st = r[0], m = r[1], p = m.pools && m.pools[0];
      var c1 = E18 / 100n, perEth = amountOut(c1 - c1 * (st.fee + st.tax) / BPS, st.quote, st.tokens);
      card([
        ['Price', m.priceUsd ? '$' + Number(m.priceUsd).toPrecision(4) : '—'],
        ['0.01 ETH buys about', fmt(perEth, 0) + ' NERBY'],
        ['24h change', p && p.priceChange ? p.priceChange.h24 + '%' : '—'],
        ['Fees per trade', Number(st.fee) / 100 + '% protocol + ' + Number(st.tax) / 100 + '% creator tax'],
        ['Curve', st.closed ? 'Graduated — trading moved to the V4 pool' : 'Open · ' + fmt(st.sellable, 0) + ' NERBY left before graduation']
      ], '$NERBY on the Pons V2 curve');
    });
  }

  function cmdBalance(t) {
    var who = t[0] && isAddr(t[0]) ? t[0] : null;
    return (who ? Promise.resolve(who) : needWallet()).then(function (a) {
      return balances(a).then(function (b) {
        card([['Address', N.link('explore.html#robinhood/' + a, N.short(a))], ['ETH', fmt(b.eth, 6)], ['NERBY', fmt(b.nerby, 2)]], 'Balance');
        if (!who) refreshBar();
      });
    });
  }

  // buy <x> eth [of nerby] · buy nerby with <x> eth · buy <n> nerby
  function cmdBuy(t) {
    var words = t.filter(function (w) { return ['of', 'with', 'for', 'worth', 'to'].indexOf(w) < 0; });
    var ethIdx = words.indexOf('eth'), nerIdx = words.indexOf('nerby');
    var ethAmt = ethIdx > 0 ? amount(words[ethIdx - 1]) : null, tokAmt = !ethAmt && nerIdx > 0 ? amount(words[nerIdx - 1]) : null;
    if (!ethAmt && words[0] && ethIdx < 0 && nerIdx < 0) ethAmt = amount(words[0]);
    if ((!ethAmt || ethAmt.pct) && (!tokAmt || tokAmt.pct)) throw new Error('Try: buy 0.01 eth  or  buy 1m nerby');
    return needWallet().then(function () { return Promise.all([curveState(account), balances(account)]); }).then(function (r) {
      var st = r[0], b = r[1];
      if (st.closed) throw new Error('$NERBY has graduated from the curve; trading moved to its Uniswap V4 pool. Terminal trading for the pool is not available yet.');
      var cut = st.fee + st.tax + st.snipe, quoteIn, outEst;
      if (ethAmt) {
        quoteIn = ethAmt.wei;
        outEst = amountOut(quoteIn - quoteIn * st.fee / BPS - quoteIn * st.tax / BPS - quoteIn * st.snipe / BPS, st.quote, st.tokens);
      } else {
        if (tokAmt.wei >= st.tokens) throw new Error('That is more than the curve holds.');
        var net = amountIn(tokAmt.wei, st.quote, st.tokens);
        quoteIn = (net * BPS + (BPS - cut) - 1n) / (BPS - cut) + 10n; // gross up for fees, round up
        outEst = tokAmt.wei;
      }
      if (quoteIn <= 0n) throw new Error('Amount is too small.');
      if (b.eth < quoteIn) throw new Error('Not enough ETH: you have ' + fmt(b.eth, 6) + ', this needs ' + fmt(quoteIn, 6) + ' plus gas.');
      var partial = outEst > st.sellable;
      if (partial) outEst = st.sellable;
      var min = outEst * BigInt(Math.round((100 - slippage) * 100)) / BPS;
      var spot = Number(st.quote) / Number(st.tokens), paid = Number(quoteIn) * (1 - Number(cut) / 10000) / Number(outEst || 1n);
      var impact = Math.max(0, (paid / spot - 1) * 100);
      pending = { kind: 'buy', tx: { to: CURVE, value: hex(quoteIn), data: SEL.buy + word(quoteIn) + word(min) + addr(account) }, label: 'Buy' };
      card([
        ['You pay', fmt(quoteIn, 6) + ' ETH'],
        ['You get about', fmt(outEst, 0) + ' NERBY', 'up'],
        ['Minimum (slippage ' + slippage + '%)', fmt(min, 0) + ' NERBY'],
        ['Price impact', impact.toFixed(2) + '%', impact > 5 ? 'warn' : ''],
        ['Fees', Number(st.fee) / 100 + '% + ' + Number(st.tax) / 100 + '% creator tax' + (st.snipe ? ' + ' + Number(st.snipe) / 100 + '% launch snipe tax' : '') + ' · Nerby adds no fee'],
        ['Route', 'Pons V2 bonding curve · Robinhood Chain']
      ].concat(partial ? [['Note', 'Only ' + fmt(st.sellable, 0) + ' NERBY are left on the curve; the rest of your ETH is refunded.', 'warn']] : []), 'Preview · buy $NERBY');
      ask();
    });
  }

  function tokenAmount(a, b) {
    if (!a) return null;
    if (a.pct) return a.pct === 100 ? b : b * BigInt(Math.round(a.pct * 100)) / BPS;
    return a.wei;
  }

  function cmdSell(t) {
    var words = t.filter(function (w) { return w !== 'of' && w !== 'for' && w !== 'eth' && w !== 'my'; });
    var i = words.indexOf('nerby'), a = amount(i > 0 ? words[i - 1] : words[0] === 'nerby' ? words[1] : words[0]);
    if (!a) throw new Error('Try: sell 500k nerby  or  sell 50% nerby  or  sell all nerby');
    return needWallet().then(function () { return Promise.all([curveState(account), balances(account)]); }).then(function (r) {
      var st = r[0], b = r[1], amt = tokenAmount(a, b.nerby);
      if (st.closed) throw new Error('$NERBY has graduated from the curve; trading moved to its Uniswap V4 pool. Terminal trading for the pool is not available yet.');
      if (!amt || amt <= 0n) throw new Error('You have no $NERBY to sell.');
      if (amt > b.nerby) throw new Error('Not enough NERBY: you have ' + fmt(b.nerby, 0) + '.');
      var gross = amountOut(amt, st.tokens, st.quote), net = gross - gross * st.fee / BPS - gross * st.tax / BPS;
      var min = net * BigInt(Math.round((100 - slippage) * 100)) / BPS;
      var spot = Number(st.quote) / Number(st.tokens), impact = Math.max(0, (1 - Number(gross) / Number(amt) / spot) * 100);
      pending = { kind: 'sell', amt: amt, tx: { to: CURVE, data: SEL.sell + word(amt) + word(min) + addr(account) }, label: 'Sell' };
      card([
        ['You sell', fmt(amt, 0) + ' NERBY'],
        ['You get about', fmt(net, 6) + ' ETH', 'up'],
        ['Minimum (slippage ' + slippage + '%)', fmt(min, 6) + ' ETH'],
        ['Price impact', impact.toFixed(2) + '%', impact > 5 ? 'warn' : ''],
        ['Fees', Number(st.fee) / 100 + '% + ' + Number(st.tax) / 100 + '% creator tax · Nerby adds no fee'],
        ['Steps', 'Approve this exact amount (only if needed), then sell']
      ], 'Preview · sell $NERBY');
      ask();
    });
  }

  function cmdSend(t, orig) {
    var to = orig.filter(isAddr)[0];
    var asset = t.indexOf('eth') >= 0 ? 'eth' : t.indexOf('nerby') >= 0 ? 'nerby' : null;
    var a = amount(t[0]);
    if (!to || !asset || !a) throw new Error('Try: send 1000 nerby to 0x…  or  send 0.01 eth to 0x…');
    if (to.toLowerCase() === TOKEN || to.toLowerCase() === CURVE) throw new Error('That is a contract address, not a wallet. Tokens sent there are lost.');
    return needWallet().then(function () { return balances(account); }).then(function (b) {
      var bal = asset === 'eth' ? b.eth : b.nerby, amt = tokenAmount(a, bal);
      if (asset === 'eth' && a.pct) throw new Error('Give an exact ETH amount so some is left for gas.');
      if (!amt || amt <= 0n) throw new Error('Nothing to send.');
      if (amt > bal) throw new Error('Not enough ' + asset.toUpperCase() + ': you have ' + fmt(bal, 6) + '.');
      pending = asset === 'eth'
        ? { kind: 'send', tx: { to: to, value: hex(amt), data: '0x' }, label: 'Send ETH' }
        : { kind: 'send', tx: { to: TOKEN, data: SEL.transfer + addr(to) + word(amt) }, label: 'Send NERBY' };
      if (to.toLowerCase() === DEAD.toLowerCase()) pending.label = 'Burn';
      card([['Send', fmt(amt, asset === 'eth' ? 6 : 2) + ' ' + asset.toUpperCase()], ['To', N.link('explore.html#robinhood/' + to, to)], ['Network', 'Robinhood Chain']], 'Preview · send');
      line('Check the address carefully. Transfers cannot be reversed.', 'warn');
      ask();
    });
  }

  function cmdBurn(t) {
    var i = t.indexOf('nerby'), a = amount(i > 0 ? t[i - 1] : t[0]);
    if (!a) throw new Error('Try: burn 10k nerby  or  burn 10% nerby');
    return needWallet().then(function () { return balances(account); }).then(function (b) {
      var amt = tokenAmount(a, b.nerby);
      if (!amt || amt <= 0n) throw new Error('You have no $NERBY to burn.');
      if (amt > b.nerby) throw new Error('Not enough NERBY: you have ' + fmt(b.nerby, 0) + '.');
      pending = { kind: 'send', tx: { to: TOKEN, data: SEL.transfer + addr(DEAD) + word(amt) }, label: 'Burn' };
      card([['Burn', fmt(amt, 2) + ' NERBY', 'hot'], ['Sent to', DEAD], ['Effect', 'Gone for good. Counted on the $NERBY page.']], 'Preview · burn');
      ask();
    });
  }

  function ask() {
    var row = N.el('span', 'task');
    var y = N.el('button', 'tbtn yes', 'Confirm'), n = N.el('button', 'tbtn', 'Cancel');
    y.addEventListener('click', function () { exec('y'); }); n.addEventListener('click', function () { exec('n'); });
    row.appendChild(document.createTextNode('Type y to confirm or n to cancel  ')); row.appendChild(y); row.appendChild(n);
    line(row, 'raw');
  }

  function confirm() {
    var p = pending; pending = null;
    var go = function () {
      if (p.kind === 'sell') {
        return N.batch([call(TOKEN, 'allowance(address,address) view returns (uint256)', [account, CURVE])]).then(function (r) {
          var have = r[0].ok ? BigInt(r[0].data.result) : 0n;
          if (have >= p.amt) return null;
          return send({ to: TOKEN, data: SEL.approve + addr(CURVE) + word(p.amt) }, 'Approve ' + fmt(p.amt, 0) + ' NERBY');
        }).then(function () { return simulate(p.tx); }).then(function () { return send(p.tx, p.label); });
      }
      return simulate(p.tx).then(function () { return send(p.tx, p.label); });
    };
    return ensureChain().then(go).then(function () { refreshBar(); return cmdBalance([]); });
  }

  // ---------- input ----------
  function exec(raw) {
    if (busy) return;
    line(frag('nerby> ', N.el('b', '', raw)), 'cmd');
    history.push(raw); hpos = history.length;
    busy = true; $('tin').disabled = true;
    var done = function () { busy = false; $('tin').disabled = false; $('tin').focus(); };
    var p;
    try { p = run(raw); } catch (e) { p = Promise.reject(e); }
    p.catch(function (e) {
      var msg = e && (e.code === 4001 || /rejected|denied/i.test(e.message || '')) ? 'You declined in your wallet. Nothing was sent.' : (e && e.message) || String(e);
      line('✗ ' + msg, 'err');
    }).then(done);
  }
  $('tform').addEventListener('submit', function (e) { e.preventDefault(); var v = $('tin').value; $('tin').value = ''; if (v.trim()) exec(v); });
  $('tin').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp' && hpos > 0) { e.preventDefault(); $('tin').value = history[--hpos]; }
    if (e.key === 'ArrowDown') { e.preventDefault(); hpos = Math.min(history.length, hpos + 1); $('tin').value = history[hpos] || ''; }
  });
  [].forEach.call(document.querySelectorAll('[data-cmd]'), function (b) { b.addEventListener('click', function () { var c = b.getAttribute('data-cmd'); if (/0x…|<|\.\.\./.test(c)) { $('tin').value = c.replace('0x…', ''); $('tin').focus(); } else exec(c); }); });
  $('tconnect').addEventListener('click', function () { if (!account) exec('connect'); });
  $('tout').addEventListener('click', function (e) { if (!e.target.closest('a,button,code')) $('tin').focus(); });
  if (window.ethereum && window.ethereum.on) window.ethereum.on('accountsChanged', function (a) { setAccount(a[0]); });
  if (window.ethereum) window.ethereum.request({ method: 'eth_accounts' }).then(function (a) { if (a[0]) setAccount(a[0]); }).catch(function () {});

  line('Nerby Terminal · $NERBY on Robinhood Chain', 'head');
  line('Type a command like  buy 0.01 eth  or  sell 50% nerby, then confirm in your wallet. Type help for everything.', 'mute');
})();
