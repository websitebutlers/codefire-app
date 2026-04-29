/* CodeFire shared interactions
   - Reveal-on-scroll observer
   - Nav scrolled-state toggle
   - Ember field generator
   - Smooth scroll for in-page anchors
   Auto-runs on DOMContentLoaded. Idempotent (safe to call init() again). */
(function () {
  function init() {
    /* Reveal observer */
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

    /* Nav scroll state */
    var nav = document.getElementById('nav');
    if (nav) {
      var onScroll = function () {
        nav.classList.toggle('scrolled', window.scrollY > 30);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    /* Ember field */
    var field = document.getElementById('ember-field');
    if (field && !field.dataset.populated) {
      field.dataset.populated = '1';
      var N = 28;
      for (var i = 0; i < N; i++) {
        var e = document.createElement('span');
        e.className = 'ember';
        var left = Math.random() * 100;
        var dx = (Math.random() - 0.5) * 200;
        var dur = 8 + Math.random() * 10;
        var delay = Math.random() * 12;
        var size = 1 + Math.random() * 3;
        e.style.left = left + '%';
        e.style.width = size + 'px';
        e.style.height = size + 'px';
        e.style.setProperty('--dx', dx + 'px');
        e.style.animationDuration = dur + 's';
        e.style.animationDelay = (-delay) + 's';
        field.appendChild(e);
      }
    }

    /* Smooth scroll to anchors */
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      if (a.dataset.smoothBound) return;
      a.dataset.smoothBound = '1';
      a.addEventListener('click', function (ev) {
        var id = a.getAttribute('href');
        if (!id || id.length < 2) return;
        var t = document.querySelector(id);
        if (!t) return;
        ev.preventDefault();
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
