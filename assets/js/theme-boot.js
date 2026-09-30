// Runs synchronously in <head> so the first paint already has the right theme.
// Also refuses to render inside another site's frame: static hosts such as GitHub Pages cannot send
// X-Frame-Options or CSP frame-ancestors, so a clickjacking page could otherwise overlay the upload buttons.
(function () {
  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    window.__terravisFramed = true;  // app.js does not start either
    try { window.top.location.replace(window.location.href); } catch (e) { /* blocked (sandbox or framebusting intervention): stay hidden */ }
    return;
  }
  var theme = null;
  try {
    var q = new URLSearchParams(window.location.search).get("theme");
    if (q === "dark" || q === "light") theme = q;
  } catch (e) { /* ignore */ }
  if (!theme) {
    try {
      var saved = window.localStorage.getItem("terravis.theme");
      if (saved === "dark" || saved === "light") theme = saved;
    } catch (e) { /* storage unavailable */ }
  }
  if (!theme) {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
