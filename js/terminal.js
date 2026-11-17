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
  var W = window.NerbyWallet;
  function wallet() {
    if (!W.provider()) throw new Error('No wallet connected. Type connect to choose one.');
    return W;
  }
  function connect() {
    return W.pick().then(function (a) { setAccount(a); return account; }, function () { throw new Error('No wallet chosen. Nothing was sent.'); });
  }
  function setAccount(a) {
    account = a ? a.toLowerCase() : null;
    $('twallet').textContent = account ? N.short(account) : 'Not connected';
    $('tconnect').textContent = account ? (W.name() || 'Wallet') + ' · ' + N.short(account) : 'Connect wallet';
    if (!account) { $('teth').textContent = '— ETH'; $('tnerby').textContent = '— NERBY'; }
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
  function needWallet() { return account && W.provider() ? Promise.resolve(account) : (line('Choose a wallet to continue…', 'mute'), connect()); }
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

  // ---------- tokens and routes ----------
  var NATIVE = '0x0000000000000000000000000000000000000000', tokCache = {};
  function tokenInfo(q) {
    q = String(q || 'nerby').toLowerCase().replace(/^\$/, '');
    if (q === 'eth') return Promise.resolve({ address: NATIVE, symbol: 'ETH', decimals: 18, native: true });
    if (tokCache[q]) return Promise.resolve(tokCache[q]);
    return fetch('/api/swap?op=token&q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (t) {
      if (t.error) throw new Error(t.error);
      tokCache[q] = t; tokCache[t.address] = t;
      return t;
    });
  }
  function units(raw, dec, max) { return N.units(BigInt(raw).toString(), dec, max === undefined ? 4 : max); }
  function parseAmt(s, dec) {
    s = String(s).toLowerCase().replace(/,/g, '');
    if (s === 'all' || s === 'max') return { pct: 100 };
    var p = /^(\d+(?:\.\d+)?)%$/.exec(s);
    if (p) { var v = Number(p[1]); return v > 0 && v <= 100 ? { pct: v } : null; }
    var m = /^(\d*\.?\d+)([kmb])?$/.exec(s);
    if (!m) return null;
    var parts = m[1].split('.'), frac = (parts[1] || '').slice(0, dec).padEnd(dec, '0');
    var w = BigInt(parts[0] || '0') * 10n ** BigInt(dec) + BigInt(frac || '0');
    return { wei: w * 10n ** BigInt({ k: 3, m: 6, b: 9 }[m[2]] || 0) };
  }
  var isNum = function (w) { return /^(\d*\.?\d+[kmb]?|\d+(\.\d+)?%|all|max)$/i.test(String(w).replace(/,/g, '')); };
  var STOP = ['of', 'for', 'with', 'worth', 'to', 'into', 'my', 'some'];

  function curveState(curve, who) {
    return N.batchRetry([
      call(curve, 'getReserves() view returns (uint256,uint256)'), call(curve, 'feeBps() view returns (uint256)'),
      call(curve, 'creatorTaxBps() view returns (uint256)'), call(curve, 'graduated() view returns (bool)'),
      call(curve, 'readyToGraduate() view returns (bool)'), call(curve, 'sellableTokens() view returns (uint256)'),
      call(curve, 'currentSnipeTaxBps(address) view returns (uint256)', [who || DEAD])
    ]).then(function (r) {
      if (!r.every(function (x) { return x.ok; })) throw new Error('Could not read the token’s curve. Try again.');
      return {
        quote: BigInt(r[0].data.result[0]), tokens: BigInt(r[0].data.result[1]), fee: BigInt(r[1].data.result), tax: BigInt(r[2].data.result),
        closed: r[3].data.result || r[4].data.result, sellable: BigInt(r[5].data.result), snipe: BigInt(r[6].data.result)
      };
    });
  }
  function balanceOf(who, t) {
    if (t.native) return N.batchRetry([['get_balance', { network: NET, address: who }]]).then(function (r) { if (!r[0].ok) throw new Error('Could not read balances.'); return BigInt(r[0].data.wei); });
    return N.batchRetry([call(t.address, 'balanceOf(address) view returns (uint256)', [who])]).then(function (r) { if (!r[0].ok) throw new Error('Could not read balances.'); return BigInt(r[0].data.result); });
  }
  function resolveAmt(a, bal, dec, label) {
    if (!a) return null;
    if (a.pct) { if (label === 'ETH') throw new Error('Give an exact ETH amount so some is left for gas.'); return a.pct === 100 ? bal : bal * BigInt(Math.round(a.pct * 100)) / BPS; }
    return a.wei;
  }

  // builds a priced, ready-to-confirm swap: curve when possible, LI.FI otherwise
  function quote(from, to, amtIn, exactOut) {
    if (from.address === to.address) throw new Error('Pick two different tokens.');
    if (from.native && to.onCurve) return curveBuy(to, amtIn, exactOut);
    if (to.native && from.onCurve) return curveSell(from, amtIn);
    if (exactOut) throw new Error('Exact-amount buys work for tokens still on their Pons curve. For ' + to.symbol + ', give the ETH amount instead, e.g. buy 0.01 eth of ' + to.symbol.toLowerCase());
    return lifi(from, to, amtIn);
  }
  function curveBuy(t, amt, exactOut) {
    var c = t.pons.curve;
    return curveState(c, account).then(function (st) {
      if (st.closed) throw new Error(t.symbol + ' has just finished its curve. Try again in a minute; it will route through its new pool.');
      var cut = st.fee + st.tax + st.snipe, quoteIn, outEst;
      if (!exactOut) { quoteIn = amt; outEst = amountOut(quoteIn - quoteIn * cut / BPS, st.quote, st.tokens); }
      else {
        if (amt >= st.tokens) throw new Error('That is more than the curve holds.');
        var net = amountIn(amt, st.quote, st.tokens);
        quoteIn = (net * BPS + (BPS - cut) - 1n) / (BPS - cut) + 10n; outEst = amt;
      }
      var partial = outEst > st.sellable; if (partial) outEst = st.sellable;
      var min = outEst * BigInt(Math.round((100 - slippage) * 100)) / BPS;
      var spot = Number(st.quote) / Number(st.tokens), paid = Number(quoteIn) * (1 - Number(cut) / 10000) / Number(outEst || 1n);
      return {
        route: 'curve', from: { symbol: 'ETH', decimals: 18, native: true }, to: t, amountIn: quoteIn, out: outEst, min: min, impact: Math.max(0, (paid / spot - 1) * 100),
        fees: Number(st.fee) / 100 + '% + ' + Number(st.tax) / 100 + '% creator tax' + (st.snipe ? ' + ' + Number(st.snipe) / 100 + '% launch snipe tax' : '') + ' (Pons curve)',
        via: 'Pons V2 bonding curve', note: partial ? 'Only ' + fmt(st.sellable, 0) + ' ' + t.symbol + ' are left on the curve; the rest of your ETH is refunded.' : null,
        tx: { to: c, value: hex(quoteIn), data: SEL.buy + word(quoteIn) + word(min) + addr(account) }, approve: null
      };
    });
  }
  function curveSell(t, amt) {
    var c = t.pons.curve;
    return curveState(c, account).then(function (st) {
      if (st.closed) throw new Error(t.symbol + ' has just finished its curve. Try again in a minute; it will route through its new pool.');
      var gross = amountOut(amt, st.tokens, st.quote), net = gross - gross * st.fee / BPS - gross * st.tax / BPS;
      var min = net * BigInt(Math.round((100 - slippage) * 100)) / BPS, spot = Number(st.quote) / Number(st.tokens);
      return {
        route: 'curve', from: t, to: { symbol: 'ETH', decimals: 18, native: true }, amountIn: amt, out: net, min: min, impact: Math.max(0, (1 - Number(gross) / Number(amt) / spot) * 100),
        fees: Number(st.fee) / 100 + '% + ' + Number(st.tax) / 100 + '% creator tax (Pons curve)', via: 'Pons V2 bonding curve',
        tx: { to: c, data: SEL.sell + word(amt) + word(min) + addr(account) }, approve: { token: t, spender: c, amount: amt }
      };
    });
  }
  function lifi(from, to, amt) {
    var u = '/api/swap?op=quote&from=' + from.address + '&to=' + to.address + '&amount=' + amt.toString() + '&address=' + account + '&slippage=' + (slippage / 100);
    return fetch(u).then(function (r) { return r.json(); }).then(function (q) {
      if (q.error) throw new Error(q.error);
      return {
        route: 'lifi', from: from, to: to, amountIn: amt, out: BigInt(q.toAmount), min: BigInt(q.toAmountMin), usd: [q.fromUsd, q.toUsd],
        impact: q.fromUsd && q.toUsd ? Math.max(0, (1 - Number(q.toUsd) / Number(q.fromUsd)) * 100) : null,
        fees: (q.fees.map(function (f) { return f.name + ' ' + f.percent.toFixed(2) + '%'; }).join(' + ') || 'DEX fees') + ' + pool fees', via: q.via + ' via LI.FI',
        tx: q.tx, approve: from.native ? null : { token: from, spender: q.approval, amount: amt },
        requote: function () { return lifi(from, to, amt); }
      };
    });
  }
  function preview(q, title) {
    var rows = [
      ['You pay', units(q.amountIn, q.from.decimals, q.from.native ? 6 : 2) + ' ' + q.from.symbol],
      ['You get about', units(q.out, q.to.decimals, q.to.native ? 6 : 0) + ' ' + q.to.symbol, 'up'],
      ['Minimum (slippage ' + slippage + '%)', units(q.min, q.to.decimals, q.to.native ? 6 : 0) + ' ' + q.to.symbol]
    ];
    if (q.impact !== null && q.impact !== undefined) rows.push([q.route === 'lifi' ? 'Price impact (est.)' : 'Price impact', q.impact.toFixed(2) + '%', q.impact > 5 ? 'warn' : '']);
    rows.push(['Fees', q.fees + ' · Nerby adds no fee']);
    rows.push(['Route', q.via + ' · Robinhood Chain']);
    if (q.approve) rows.push(['Steps', 'Approve this exact ' + q.approve.token.symbol + ' amount (only if needed), then swap']);
    if (q.note) rows.push(['Note', q.note, 'warn']);
    card(rows, title);
    var other = (q.to.alsoNamed || []).concat(q.from.alsoNamed || []);
    if (other.length) line('Other tokens use this name too. Check the address: ' + (q.to.native ? q.from.address : q.to.address), 'warn');
    var lbl = title.replace('Preview · ', ''); pending = { q: q, label: lbl.charAt(0).toUpperCase() + lbl.slice(1) };
    ask();
  }

  // ---------- commands ----------
  var HELP = [
    ['buy 0.01 eth', 'Buy $NERBY with 0.01 ETH'],
    ['buy 0.01 eth of hylit', 'Buy any Robinhood Chain token by name or 0x address'],
    ['buy 1m nerby', 'Buy an exact amount (tokens still on a Pons curve)'],
    ['sell 50% nerby', 'Sell a token for ETH: 500k, 1m, 50% or all'],
    ['swap 100k nerby to wif', 'Swap one token for another'],
    ['send 1000 nerby to 0x…', 'Send any token or ETH to an address'],
    ['burn 10k nerby', 'Send a token to the burn address'],
    ['price wif', 'Price and how a token trades'],
    ['balance [token|0x…]', 'Your balances, a token, or any address'],
    ['slippage 2', 'Set slippage tolerance in % (now ' + slippage + '%)'],
    ['connect · wallet · disconnect', 'Choose, show or disconnect your wallet'],
    ['clear · help', '']
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
    var c = t[0], rest = t.slice(1).filter(function (w) { return STOP.indexOf(w) < 0; });
    if (c === 'help' || c === '?') return Promise.resolve(help());
    if (c === 'clear') { out.textContent = ''; return Promise.resolve(); }
    if (c === 'connect') return connect().then(function () { line('Connected ' + (W.name() || 'wallet') + ' · ' + account, 'ok'); return cmdBalance([]); });
    if (c === 'disconnect') { W.disconnect(); setAccount(null); line('Disconnected. Type connect to choose a wallet.', 'mute'); return Promise.resolve(); }
    if (c === 'wallet') return Promise.resolve(walletCard());
    if (c === 'slippage') { var v = Number(t[1]); if (!(v > 0 && v <= 50)) throw new Error('Use a number between 0.1 and 50, for example: slippage 2'); slippage = v; line('Slippage set to ' + v + '%.', 'ok'); return Promise.resolve(); }
    if (c === 'price') return cmdPrice(rest[0]);
    if (c === 'balance' || c === 'bal') return cmdBalance(rest);
    if (c === 'buy') return cmdBuy(rest);
    if (c === 'sell') return cmdSell(rest);
    if (c === 'swap' || c === 'trade') return cmdSwap(t.slice(1));
    if (c === 'send' || c === 'transfer') return cmdSend(rest, s.split(' ').slice(1));
    if (c === 'burn') return cmdBurn(rest);
    throw new Error('Unknown command "' + c + '". Type help to see what works.');
  }

  function cmdPrice(q) {
    return tokenInfo(q || 'nerby').then(function (t) {
      if (t.native) throw new Error('Name a token, for example: price nerby');
      var m = fetch('/api/market?network=' + NET + '&token=' + t.address).then(function (r) { return r.json(); }).catch(function () { return {}; });
      var st = t.onCurve ? curveState(t.pons.curve, account) : Promise.resolve(null);
      return Promise.all([m, st]).then(function (r) {
        var mk = r[0], s2 = r[1], p = mk.pools && mk.pools[0];
        var rows = [['Price', mk.priceUsd ? '$' + Number(mk.priceUsd).toPrecision(4) : '—'], ['24h change', p && p.priceChange ? p.priceChange.h24 + '%' : '—'],
          ['Address', N.link('explore.html#robinhood/' + t.address, t.address)]];
        if (s2) {
          var c1 = E18 / 100n;
          rows.push(['0.01 ETH buys about', fmt(amountOut(c1 - c1 * (s2.fee + s2.tax) / BPS, s2.quote, s2.tokens), 0) + ' ' + t.symbol]);
          rows.push(['Trades on', 'Pons curve · ' + Number(s2.fee) / 100 + '% fee + ' + Number(s2.tax) / 100 + '% creator tax']);
        } else rows.push(['Trades on', (t.pons ? 'Its graduated pool' : 'DEX pools') + ' · routed by LI.FI']);
        card(rows, '$' + t.symbol);
      });
    });
  }

  function cmdBalance(t) {
    var who = t[0] && isAddr(t[0]) ? t[0] : null, tok = t[0] && !who ? t[0] : null;
    return (who ? Promise.resolve(who) : needWallet()).then(function (a) {
      var list = [tokenInfo('eth'), tokenInfo('nerby')]; if (tok && tok !== 'nerby' && tok !== 'eth') list.push(tokenInfo(tok));
      return Promise.all(list).then(function (toks) {
        return Promise.all(toks.map(function (x) { return balanceOf(a, x); })).then(function (bals) {
          card([['Address', N.link('explore.html#robinhood/' + a, N.short(a))]].concat(toks.map(function (x, i) { return [x.symbol, units(bals[i], x.decimals, x.native ? 6 : 2)]; })), 'Balance');
          if (!who) refreshBar();
        });
      });
    });
  }

  // buy 0.01 eth [of] TOKEN · buy TOKEN [with] 0.01 eth · buy 1m TOKEN · buy 0.01 eth (→ nerby)
  function cmdBuy(w) {
    var e = w.indexOf('eth'), amtWord, tokWord, exactOut = false;
    if (e >= 0) {
      amtWord = e > 0 && isNum(w[e - 1]) ? w[e - 1] : w[e + 1];
      tokWord = w.filter(function (x, i) { return i !== e && x !== amtWord; })[0] || 'nerby';
    } else { amtWord = w.filter(isNum)[0]; tokWord = w.filter(function (x) { return !isNum(x); })[0] || 'nerby'; exactOut = true; }
    if (!amtWord || !isNum(amtWord)) throw new Error('Try: buy 0.01 eth of nerby  or  buy 1m nerby');
    return needWallet().then(function () { return Promise.all([tokenInfo('eth'), tokenInfo(tokWord)]); }).then(function (tk) {
      var eth = tk[0], to = tk[1];
      if (to.native) throw new Error('Name the token to buy, e.g. buy 0.01 eth of nerby');
      var a = parseAmt(amtWord, exactOut ? to.decimals : 18);
      if (!a || a.pct) throw new Error('Give a fixed amount to buy, e.g. buy 0.01 eth of ' + to.symbol.toLowerCase());
      return Promise.all([balanceOf(account, eth), quote(eth, to, a.wei, exactOut)]).then(function (r) {
        if (r[0] < r[1].amountIn) throw new Error('Not enough ETH: you have ' + fmt(r[0], 6) + ', this needs ' + fmt(r[1].amountIn, 6) + ' plus gas.');
        preview(r[1], 'Preview · buy $' + to.symbol);
      });
    });
  }

  function cmdSell(w) {
    var amtWord = w.filter(isNum)[0], tokWord = w.filter(function (x) { return !isNum(x) && x !== 'eth'; })[0] || 'nerby';
    if (!amtWord) throw new Error('Try: sell 500k nerby  or  sell 50% wif  or  sell all nerby');
    return needWallet().then(function () { return Promise.all([tokenInfo(tokWord), tokenInfo('eth')]); }).then(function (tk) {
      var from = tk[0];
      if (from.native) throw new Error('Name the token to sell, e.g. sell 50% nerby');
      return balanceOf(account, from).then(function (bal) {
        var amt = resolveAmt(parseAmt(amtWord, from.decimals), bal, from.decimals, from.symbol);
        if (!amt || amt <= 0n) throw new Error('You have no ' + from.symbol + ' to sell.');
        if (amt > bal) throw new Error('Not enough ' + from.symbol + ': you have ' + units(bal, from.decimals, 2) + '.');
        return quote(from, tk[1], amt).then(function (q) { preview(q, 'Preview · sell $' + from.symbol); });
      });
    });
  }

  // swap 100k nerby to wif · swap 0.01 eth to nerby · swap 50% wif for eth
  function cmdSwap(w) {
    var sep = w.findIndex(function (x) { return x === 'to' || x === 'for' || x === 'into'; });
    if (sep < 2) throw new Error('Try: swap 100k nerby to wif');
    var amtWord = w[0], fromWord = w.slice(1, sep).join(''), toWord = w.slice(sep + 1).join('');
    if (!isNum(amtWord) || !toWord) throw new Error('Try: swap 100k nerby to wif');
    return needWallet().then(function () { return Promise.all([tokenInfo(fromWord), tokenInfo(toWord)]); }).then(function (tk) {
      var from = tk[0], to = tk[1];
      return balanceOf(account, from).then(function (bal) {
        var amt = resolveAmt(parseAmt(amtWord, from.decimals), bal, from.decimals, from.symbol);
        if (!amt || amt <= 0n) throw new Error('Nothing to swap.');
        if (amt > bal) throw new Error('Not enough ' + from.symbol + ': you have ' + units(bal, from.decimals, from.native ? 6 : 2) + '.');
        return quote(from, to, amt).then(function (q) { preview(q, 'Preview · swap $' + from.symbol + ' → $' + to.symbol); });
      });
    });
  }

  function cmdSend(w, orig) {
    var to = orig.filter(isAddr)[0];
    var amtWord = w.filter(isNum)[0], tokWord = w.filter(function (x) { return !isNum(x) && !isAddr(x); })[0] || 'nerby';
    if (!to || !amtWord) throw new Error('Try: send 1000 nerby to 0x…  or  send 0.01 eth to 0x…');
    return needWallet().then(function () { return tokenInfo(tokWord); }).then(function (t) {
      if (!t.native && (to.toLowerCase() === t.address || (t.pons && to.toLowerCase() === t.pons.curve))) throw new Error('That is a contract address, not a wallet. Tokens sent there are lost.');
      return balanceOf(account, t).then(function (bal) {
        var amt = resolveAmt(parseAmt(amtWord, t.decimals), bal, t.decimals, t.symbol);
        if (!amt || amt <= 0n) throw new Error('Nothing to send.');
        if (amt > bal) throw new Error('Not enough ' + t.symbol + ': you have ' + units(bal, t.decimals, t.native ? 6 : 2) + '.');
        var burn = to.toLowerCase() === DEAD.toLowerCase();
        pending = { q: { tx: t.native ? { to: to, value: hex(amt), data: '0x' } : { to: t.address, data: SEL.transfer + addr(to) + word(amt) } }, label: burn ? 'Burn' : 'Send ' + t.symbol };
        card([['Send', units(amt, t.decimals, t.native ? 6 : 2) + ' ' + t.symbol], ['To', N.link('explore.html#robinhood/' + to, to)], ['Network', 'Robinhood Chain']], 'Preview · send');
        line('Check the address carefully. Transfers cannot be reversed.', 'warn');
        ask();
      });
    });
  }

  function cmdBurn(w) {
    var amtWord = w.filter(isNum)[0], tokWord = w.filter(function (x) { return !isNum(x); })[0] || 'nerby';
    if (!amtWord) throw new Error('Try: burn 10k nerby  or  burn 10% nerby');
    return needWallet().then(function () { return tokenInfo(tokWord); }).then(function (t) {
      if (t.native) throw new Error('Burning works for tokens, not ETH.');
      return balanceOf(account, t).then(function (bal) {
        var amt = resolveAmt(parseAmt(amtWord, t.decimals), bal, t.decimals, t.symbol);
        if (!amt || amt <= 0n) throw new Error('You have no ' + t.symbol + ' to burn.');
        if (amt > bal) throw new Error('Not enough ' + t.symbol + ': you have ' + units(bal, t.decimals, 0) + '.');
        pending = { q: { tx: { to: t.address, data: SEL.transfer + addr(DEAD) + word(amt) } }, label: 'Burn' };
        card([['Burn', units(amt, t.decimals, 2) + ' ' + t.symbol, 'hot'], ['Sent to', DEAD], ['Effect', 'Gone for good' + (t.address === TOKEN ? '. Counted on the $NERBY page.' : '.')]], 'Preview · burn');
        ask();
      });
    });
  }

  function walletCard() {
    if (!account) { line('No wallet connected. Type connect to choose one.', 'mute'); return; }
    card([['Wallet', W.name() || 'Browser wallet'], ['Address', N.link('explore.html#robinhood/' + account, account)]], 'Connected');
    var row = N.el('span', 'task'), sw = N.el('button', 'tbtn', 'Switch wallet'), dc = N.el('button', 'tbtn', 'Disconnect');
    sw.addEventListener('click', function () { exec('connect'); }); dc.addEventListener('click', function () { exec('disconnect'); });
    row.appendChild(sw); row.appendChild(dc); line(row, 'raw');
  }

  function ask() {
    var row = N.el('span', 'task');
    var y = N.el('button', 'tbtn yes', 'Confirm'), n = N.el('button', 'tbtn', 'Cancel');
    y.addEventListener('click', function () { exec('y'); }); n.addEventListener('click', function () { exec('n'); });
    row.appendChild(document.createTextNode('Type y to confirm or n to cancel  ')); row.appendChild(y); row.appendChild(n);
    line(row, 'raw');
  }

  function approveIfNeeded(ap) {
    if (!ap) return Promise.resolve();
    return N.batchRetry([call(ap.token.address, 'allowance(address,address) view returns (uint256)', [account, ap.spender])]).then(function (r) {
      var have = r[0].ok ? BigInt(r[0].data.result) : 0n;
      if (have >= ap.amount) return null;
      return send({ to: ap.token.address, data: SEL.approve + addr(ap.spender) + word(ap.amount) }, 'Approve ' + units(ap.amount, ap.token.decimals, 0) + ' ' + ap.token.symbol);
    });
  }
  function confirm() {
    var p = pending, q = p.q, approved = false; pending = null;
    return ensureChain().then(function () { return approveIfNeeded(q.approve); }).then(function (r) {
      approved = !!r;
      // routes from LI.FI expire quickly: fetch a fresh one and make sure it is not worse than what was shown
      if (!q.requote) return q;
      line('Refreshing the route…', 'mute');
      return q.requote().then(function (f) {
        if (f.min * 1000n < q.min * 995n) throw new Error('The price moved: you would now get at least ' + units(f.min, f.to.decimals, 0) + ' ' + f.to.symbol + ' instead of ' + units(q.min, q.to.decimals, 0) + '. Nothing was sent; run the command again to see the new quote.');
        return f;
      });
    }).then(function (f) {
      // right after an approval the node may need a moment to see it; give the dry-run one more try
      var dry = function () { return simulate(f.tx).catch(function (e) { if (!approved) throw e; return new Promise(function (ok) { setTimeout(ok, 2500); }).then(function () { return simulate(f.tx); }); }); };
      return dry().then(function (sim) {
        var tx = Object.assign({}, f.tx);
        if (sim && sim.unsignedTransaction && sim.unsignedTransaction.gas) tx.gas = sim.unsignedTransaction.gas;
        return send(tx, p.label);
      });
    }).then(function () { refreshBar(); return cmdBalance([]); });
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
  $('tconnect').addEventListener('click', function () { exec(account ? 'wallet' : 'connect'); });
  $('tout').addEventListener('click', function (e) { if (!e.target.closest('a,button,code')) $('tin').focus(); });
  W.onChange(function (a) { if ((a || null) !== account) setAccount(a); });
  W.restore();

  line('Nerby Terminal · any token on Robinhood Chain', 'head');
  line('Type a command like  buy 0.01 eth of nerby,  sell 50% wif  or  swap 100k nerby to wif, then confirm in your wallet. Type help for everything.', 'mute');
})();
