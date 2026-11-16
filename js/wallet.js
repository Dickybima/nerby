/* Nerby Protocol — wallet picker. Finds every browser wallet through EIP-6963, lets the visitor
   choose one, and on phones offers to open the page inside a wallet app's browser. */
window.NerbyWallet = (function () {
  'use strict';
  var found = [], provider = null, info = null, account = null, listeners = [], KEY = 'nerby.wallet';

  window.addEventListener('eip6963:announceProvider', function (e) {
    var d = e.detail;
    if (!d || !d.info || !d.provider) return;
    if (found.some(function (w) { return w.info.uuid === d.info.uuid || w.info.rdns === d.info.rdns; })) return;
    found.push(d);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  function store(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {} }
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function emit() { listeners.forEach(function (f) { f(account, info); }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  // wallets without EIP-6963 still expose window.ethereum
  function list() {
    var all = found.slice();
    var legacy = window.ethereum;
    if (legacy && !all.some(function (w) { return w.provider === legacy; })) {
      var name = legacy.isRabby ? 'Rabby' : legacy.isCoinbaseWallet ? 'Coinbase Wallet' : legacy.isOkxWallet || legacy.isOKExWallet ? 'OKX Wallet' : legacy.isTrust || legacy.isTrustWallet ? 'Trust Wallet' : legacy.isBraveWallet ? 'Brave Wallet' : legacy.isMetaMask ? 'MetaMask' : 'Browser wallet';
      all.push({ info: { uuid: 'legacy', name: name, icon: '', rdns: 'legacy' }, provider: legacy });
    }
    return all;
  }

  function use(w) {
    if (provider && provider.removeListener) { try { provider.removeListener('accountsChanged', onAccounts); } catch (e) {} }
    provider = w.provider; info = w.info;
    if (provider.on) provider.on('accountsChanged', onAccounts);
  }
  function onAccounts(a) { account = a && a[0] ? a[0].toLowerCase() : null; if (!account) { info = null; provider = null; store(null); } emit(); }

  function connectWith(w) {
    use(w);
    return provider.request({ method: 'eth_requestAccounts' }).then(function (a) {
      account = a[0].toLowerCase(); store(w.info.rdns); emit(); return account;
    });
  }

  var phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  function deepLinks() {
    var host = location.host + location.pathname, url = encodeURIComponent(location.href);
    return [
      ['MetaMask', 'https://metamask.app.link/dapp/' + host],
      ['Coinbase Wallet', 'https://go.cb-w.com/dapp?cb_url=' + url],
      ['Trust Wallet', 'https://link.trustwallet.com/open_url?coin_id=60&url=' + url],
      ['OKX Wallet', 'okx://wallet/dapp/url?dappUrl=' + url],
      ['Rainbow', 'https://rnbwapp.com/dapp?url=' + url]
    ];
  }

  // shows the picker; resolves with the connected account, rejects if closed
  function pick() {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        var wallets = list(), back = el('div', 'wpick'), box = el('div', 'wbox');
        box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Connect a wallet');
        var head = el('div', 'whead'); head.appendChild(el('b', '', 'Connect a wallet'));
        var x = el('button', 'wx', '×'); x.setAttribute('aria-label', 'Close'); head.appendChild(x); box.appendChild(head);
        var status = el('p', 'wstat');
        var close = function (err) { document.removeEventListener('keydown', esc); back.remove(); if (err) reject(err); };
        var esc = function (e) { if (e.key === 'Escape') close(new Error('closed')); };
        document.addEventListener('keydown', esc);
        x.addEventListener('click', function () { close(new Error('closed')); });
        back.addEventListener('click', function (e) { if (e.target === back) close(new Error('closed')); });

        if (wallets.length) {
          box.appendChild(el('p', 'wsub', 'Installed in this browser'));
          var ul = el('div', 'wlist');
          wallets.forEach(function (w) {
            var b = el('button', 'witem');
            if (w.info.icon) { var img = el('img'); img.src = w.info.icon; img.alt = ''; b.appendChild(img); } else b.appendChild(el('i', 'wdot'));
            b.appendChild(el('span', '', w.info.name));
            if (stored() === w.info.rdns) b.appendChild(el('small', '', 'Last used'));
            b.addEventListener('click', function () {
              status.textContent = 'Approve the connection in ' + w.info.name + '…'; status.className = 'wstat';
              connectWith(w).then(function (a) { close(); resolve(a); }).catch(function (e) {
                status.textContent = e && e.code === 4001 ? 'You declined in ' + w.info.name + '. Pick a wallet to try again.' : 'Could not connect: ' + ((e && e.message) || e); status.className = 'wstat err';
              });
            });
            ul.appendChild(b);
          });
          box.appendChild(ul);
        } else {
          box.appendChild(el('p', 'wsub', phone ? 'No wallet in this browser. Open this page inside your wallet app:' : 'No browser wallet found. Install one such as MetaMask or Rabby, then reload this page.'));
        }
        if (phone || !wallets.length) {
          if (wallets.length) box.appendChild(el('p', 'wsub', 'Or open this page in a wallet app'));
          var dl = el('div', 'wlist');
          deepLinks().forEach(function (d) { var a = el('a', 'witem'); a.href = d[1]; a.appendChild(el('i', 'wdot')); a.appendChild(el('span', '', d[0])); a.appendChild(el('small', '', 'Open app')); dl.appendChild(a); });
          box.appendChild(dl);
        }
        box.appendChild(status);
        box.appendChild(el('p', 'wfine', 'Nerby Protocol never sees your keys. Your wallet signs everything.'));
        back.appendChild(box); document.body.appendChild(back);
        var first = box.querySelector('.witem'); if (first) first.focus();
      }, 250);
    });
  }

  // reconnect quietly to the wallet used last time, without a popup
  function restore() {
    var r = stored();
    return new Promise(function (ok) { setTimeout(ok, 300); }).then(function () {
      var w = list().filter(function (x) { return x.info.rdns === r; })[0];
      if (!w) return null;
      return w.provider.request({ method: 'eth_accounts' }).then(function (a) {
        if (!a || !a[0]) return null;
        use(w); account = a[0].toLowerCase(); emit(); return account;
      }).catch(function () { return null; });
    });
  }

  function disconnect() {
    var p = provider;
    account = null; provider = null; info = null; store(null); emit();
    if (p && p.request) p.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(function () {});
  }

  return {
    pick: pick, restore: restore, disconnect: disconnect,
    onChange: function (f) { listeners.push(f); },
    provider: function () { return provider; }, account: function () { return account; }, name: function () { return info ? info.name : null; },
    request: function (args) { if (!provider) return Promise.reject(new Error('No wallet connected.')); return provider.request(args); }
  };
})();
