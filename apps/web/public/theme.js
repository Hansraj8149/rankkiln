// Applies the saved theme before first paint, and wires any [data-theme-switch] buttons on the page.
(function () {
  var KEY = "rk-theme";
  var root = document.documentElement;
  function read() {
    try {
      return localStorage.getItem(KEY) || "system";
    } catch {
      return "system";
    }
  }
  function apply(mode) {
    if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme");
    var buttons = document.querySelectorAll("[data-theme-switch] button[data-mode]");
    for (var i = 0; i < buttons.length; i++)
      buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-mode") === mode));
  }
  apply(read());
  document.addEventListener("DOMContentLoaded", function () {
    apply(read());
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-theme-switch] button[data-mode]");
      if (!b) return;
      var mode = b.getAttribute("data-mode");
      try {
        localStorage.setItem(KEY, mode);
      } catch {
        /* private mode: the choice lasts for this page only */
      }
      apply(mode);
    });
  });
})();
