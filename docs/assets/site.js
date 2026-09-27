/* napkin-sketch documentation: the theme button, and the menu on a narrow
   screen. Nothing else, and nothing fetched. Loaded in the head, so the
   stored theme is on the page before it is drawn. */
(function () {
  var KEY = 'napkin-sketch-docs-theme';
  var root = document.documentElement;

  function stored() {
    try {
      return window.localStorage.getItem(KEY);
    } catch (error) {
      return null;
    }
  }

  function apply(theme) {
    if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  }

  function current() {
    var chosen = root.getAttribute('data-theme');
    if (chosen) return chosen;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  apply(stored());

  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('[data-theme-toggle]');
    function label() {
      if (toggle) toggle.textContent = current() === 'dark' ? 'Light' : 'Dark';
    }
    label();
    if (toggle) {
      toggle.addEventListener('click', function () {
        var next = current() === 'dark' ? 'light' : 'dark';
        apply(next);
        try {
          window.localStorage.setItem(KEY, next);
        } catch (error) {
          // A browser that stores nothing still switches for this page.
        }
        label();
      });
    }

    var button = document.querySelector('[data-menu-toggle]');
    var scrim = document.querySelector('[data-scrim]');
    function setMenu(open) {
      document.body.classList.toggle('menu-open', open);
      if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (button) {
      button.addEventListener('click', function () {
        setMenu(!document.body.classList.contains('menu-open'));
      });
    }
    if (scrim) scrim.addEventListener('click', function () { setMenu(false); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setMenu(false);
    });

    // The menu scrolls on its own: bring the current page's row into it.
    var menu = document.getElementById('menu');
    var here = menu && menu.querySelector('[aria-current="page"]');
    if (menu && here) menu.scrollTop = Math.max(0, here.offsetTop - menu.clientHeight / 2);
  });
})();
