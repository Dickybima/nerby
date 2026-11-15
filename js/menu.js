/* Nerby Protocol — mobile menu, plus copy buttons and footer year on content pages */
(function () {
  'use strict';
  var btn = document.getElementById('mbtn'), mob = document.getElementById('mob');

  if (btn && mob) {
    // build the mobile menu from the desktop dropdowns so there is one source of links
    [].forEach.call(document.querySelectorAll('.menu .mi'), function (mi) {
      var sec = document.createElement('section'), h = document.createElement('h2');
      h.textContent = mi.querySelector('.mt').textContent;
      sec.appendChild(h);
      [].forEach.call(mi.querySelectorAll('.mpi a'), function (a) {
        var l = document.createElement('a');
        l.href = a.getAttribute('href');
        l.textContent = a.querySelector('b').textContent;
        sec.appendChild(l);
      });
      mob.appendChild(sec);
    });
    var x = document.querySelector('.menu .cta');
    if (x) {
      var xs = document.createElement('section'), xl = document.createElement('a');
      xl.href = x.href; xl.target = '_blank'; xl.rel = 'noopener'; xl.textContent = '@nerbyprotocol on X';
      xs.appendChild(xl); mob.appendChild(xs);
    }
    var set = function (open) {
      mob.hidden = !open;
      btn.setAttribute('aria-expanded', open);
      btn.textContent = open ? 'Close' : 'Menu';
      document.documentElement.style.overflow = open ? 'hidden' : '';
    };
    btn.addEventListener('click', function () { set(mob.hidden); });
    mob.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mob.hidden) set(false); });
  }

  function copy(text, label) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      var old = label.textContent;
      label.textContent = 'Copied';
      setTimeout(function () { label.textContent = old; }, 1600);
    }, function () {});
  }
  document.addEventListener('click', function (e) {
    var cb = e.target.closest('.cbb');
    if (cb) return copy(cb.getAttribute('data-copy'), cb);
    // the home page handles its own endpoint boxes in app.js
    if (!document.body.classList.contains('page')) return;
    var b = e.target.closest('.ep-b');
    if (b) copy(b.parentNode.getAttribute('data-copy'), b.querySelector('i'));
  });

  if (document.body.classList.contains('page')) {
    var yr = document.getElementById('yr');
    if (yr) yr.textContent = new Date().getFullYear();
  }
})();
