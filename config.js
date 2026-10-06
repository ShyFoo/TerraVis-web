// Deployment settings, loaded before the app; normally the only file to edit. Exception:
// a remote apiBase must also be added to connect-src in the Content-Security-Policy <meta> of index.html,
// and the site's origin to TERRAVIS_WEB_ALLOWED_ORIGINS on the API.
// URL overrides for demos: ?mock (built-in simulator), &autorun=<example id>, &speed=<n>, &theme=dark|light,
// &mockerror=<error code> (simulator only, e.g. rate_limited, judge_offline, judge_error).
window.TERRAVIS_CONFIG = {
  apiBase: "closed",            // "" = same origin; "https://api.example.org" = remote; "mock" = built-in simulator; "closed" = evaluation off
  paperUrl: "",           // empty → hide the link
  codeUrl: "https://github.com/ShyFoo/TerraVis",  // the TerraVis code (404 for visitors until it is public)
  issuesUrl: "https://github.com/ShyFoo/TerraVis/issues",  // footer "Report an issue"; empty -> <codeUrl>/issues
  projectUrl: "",
  turnstileSiteKey: "",   // Cloudflare Turnstile; empty → no captcha widget
};
