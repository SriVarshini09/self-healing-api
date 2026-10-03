export const apiDocsCss = String.raw`
:root {
  --shapi-ink: #061019;
  --shapi-panel: #0a1825;
  --shapi-panel-raised: #0e2030;
  --shapi-line: rgba(103, 232, 249, .2);
  --shapi-text: #e8f9ff;
  --shapi-muted: #86a7b8;
  --shapi-cyan: #67e8f9;
  --shapi-violet: #a78bfa;
  --shapi-mint: #7ef7d1;
  --shapi-amber: #fbbf24;
}

html, body { min-height: 100%; }
body {
  margin: 0;
  color: var(--shapi-text);
  background:
    radial-gradient(900px 500px at 85% -10%, rgba(139, 92, 246, .18), transparent 66%),
    radial-gradient(780px 520px at 8% 5%, rgba(34, 211, 238, .1), transparent 66%),
    var(--shapi-ink);
  transition: background .25s ease, color .25s ease;
}

.swagger-ui { color: var(--shapi-text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
.swagger-ui .topbar {
  padding: 15px 0;
  background: rgba(5, 15, 25, .86);
  border-bottom: 1px solid var(--shapi-line);
  box-shadow: 0 14px 40px rgba(0, 0, 0, .18);
  backdrop-filter: blur(14px);
}
.swagger-ui .topbar .wrapper { max-width: 1240px; display: flex; align-items: center; gap: 18px; }
.swagger-ui .topbar .download-url-wrapper { margin-left: auto; }
.swagger-ui .topbar .download-url-wrapper input[type=text] { border: 1px solid var(--shapi-line); border-radius: 7px 0 0 7px; background: var(--shapi-panel); color: var(--shapi-text); }
.swagger-ui .topbar .download-url-wrapper .download-url-button { border-radius: 0 7px 7px 0; background: var(--shapi-cyan); color: #04232b; }
.shapi-console-brand { display: flex; align-items: center; gap: 10px; min-width: 210px; }
.shapi-console-mark { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid rgba(103, 232, 249, .55); border-radius: 9px; color: var(--shapi-cyan); background: linear-gradient(145deg, rgba(34, 211, 238, .2), rgba(139, 92, 246, .24)); box-shadow: 0 0 24px rgba(34, 211, 238, .18); font: 800 12px/1 ui-monospace, SFMono-Regular, monospace; }
.shapi-console-name { color: var(--shapi-text); font: 800 13px/1.1 ui-monospace, SFMono-Regular, monospace; letter-spacing: .08em; text-transform: uppercase; }
.shapi-console-subtitle { margin-top: 4px; color: var(--shapi-muted); font-size: 10px; }
.shapi-theme-toggle { border: 1px solid var(--shapi-line); border-radius: 7px; padding: 8px 10px; color: var(--shapi-text); background: rgba(103, 232, 249, .08); font: 700 10px ui-monospace, SFMono-Regular, monospace; cursor: pointer; transition: background .2s ease, border-color .2s ease, transform .2s ease; }
.shapi-theme-toggle:hover, .shapi-theme-toggle:focus-visible { border-color: rgba(103, 232, 249, .7); background: rgba(103, 232, 249, .18); outline: none; transform: translateY(-1px); }
.swagger-ui .information-container { max-width: 1240px; padding: 32px 20px 0; }
.swagger-ui .info .title { color: var(--shapi-text); font: 800 34px/1.05 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: -.04em; }
.swagger-ui .info .title small { top: -4px; border-radius: 999px; color: #06222b; background: var(--shapi-cyan); font: 800 10px ui-monospace, SFMono-Regular, monospace; }
.swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info a { color: var(--shapi-muted); }
.swagger-ui .info a { color: var(--shapi-cyan); }
.shapi-console-banner { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-top: 24px; padding: 16px 18px; border: 1px solid var(--shapi-line); border-radius: 12px; background: linear-gradient(110deg, rgba(34, 211, 238, .11), rgba(139, 92, 246, .1)); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06); }
.shapi-console-banner-copy strong { display: block; color: var(--shapi-text); font: 800 12px ui-monospace, SFMono-Regular, monospace; letter-spacing: .08em; text-transform: uppercase; }
.shapi-console-banner-copy span { display: block; margin-top: 5px; color: var(--shapi-muted); font-size: 11px; }
.shapi-console-links { display: flex; flex-wrap: wrap; gap: 7px; }
.shapi-console-links a { border: 1px solid var(--shapi-line); border-radius: 6px; padding: 7px 9px; color: var(--shapi-cyan) !important; background: rgba(4, 20, 32, .5); font: 700 9px ui-monospace, SFMono-Regular, monospace; text-decoration: none; }
.shapi-console-links a:hover, .shapi-console-links a:focus-visible { border-color: rgba(103, 232, 249, .68); background: rgba(34, 211, 238, .16); outline: none; }
.swagger-ui .scheme-container { max-width: 1240px; margin: 20px auto 10px; border: 1px solid var(--shapi-line); border-radius: 10px; background: rgba(10, 24, 37, .72); box-shadow: none; }
.swagger-ui .servers > label, .swagger-ui .servers-title { color: var(--shapi-muted); }
.swagger-ui select { border: 1px solid var(--shapi-line); border-radius: 6px; color: var(--shapi-text); background: var(--shapi-panel); }
.swagger-ui .opblock-tag-section { max-width: 1240px; margin: 0 auto; }
.swagger-ui .opblock-tag { margin: 18px 20px 8px; padding: 14px 0; border-bottom: 1px solid var(--shapi-line); color: var(--shapi-text); font: 800 15px ui-monospace, SFMono-Regular, monospace; }
.swagger-ui .opblock-tag small { color: var(--shapi-muted); font: 11px Inter, ui-sans-serif, system-ui, sans-serif; }
.swagger-ui .opblock { margin: 10px 20px; border: 1px solid var(--shapi-line); border-radius: 10px; background: rgba(10, 24, 37, .72); box-shadow: 0 10px 30px rgba(0, 0, 0, .12); overflow: hidden; }
.swagger-ui .opblock .opblock-summary { border-color: transparent; }
.swagger-ui .opblock .opblock-summary-description { color: var(--shapi-muted); }
.swagger-ui .opblock .opblock-summary-method { border-radius: 5px; box-shadow: none; font: 800 10px ui-monospace, SFMono-Regular, monospace; }
.swagger-ui .opblock.opblock-get { border-color: rgba(103, 232, 249, .3); background: rgba(34, 211, 238, .07); }
.swagger-ui .opblock.opblock-post { border-color: rgba(126, 247, 209, .3); background: rgba(126, 247, 209, .06); }
.swagger-ui .opblock.opblock-put, .swagger-ui .opblock.opblock-patch { border-color: rgba(167, 139, 250, .32); background: rgba(139, 92, 246, .07); }
.swagger-ui .opblock.opblock-delete { border-color: rgba(251, 191, 36, .32); background: rgba(251, 191, 36, .06); }
.swagger-ui .opblock-body, .swagger-ui .opblock-section-header { color: var(--shapi-text); background: rgba(4, 13, 23, .52); }
.swagger-ui .opblock-section-header { border-color: var(--shapi-line); }
.swagger-ui table thead tr td, .swagger-ui table thead tr th, .swagger-ui .parameter__name, .swagger-ui .parameter__type, .swagger-ui .response-col_status { color: var(--shapi-text); }
.swagger-ui .parameter__in, .swagger-ui .response-col_description, .swagger-ui .response-col_links, .swagger-ui .model-title, .swagger-ui .model { color: var(--shapi-muted); }
.swagger-ui input, .swagger-ui textarea { border: 1px solid var(--shapi-line); border-radius: 5px; color: var(--shapi-text); background: var(--shapi-panel); }
.swagger-ui .btn { border-radius: 6px; border-color: var(--shapi-line); color: var(--shapi-text); }
.swagger-ui .btn.execute { border-color: transparent; color: #06222b; background: var(--shapi-cyan); }
.swagger-ui .highlight-code, .swagger-ui .microlight { color: #d9f8ff; background: #061019; }
.swagger-ui section.models { max-width: 1240px; margin: 25px auto; border-color: var(--shapi-line); }

html.shapi-light {
  --shapi-ink: #f4f8fb;
  --shapi-panel: #ffffff;
  --shapi-panel-raised: #edf7fb;
  --shapi-line: rgba(14, 116, 144, .2);
  --shapi-text: #123047;
  --shapi-muted: #567284;
  --shapi-cyan: #087c9c;
  --shapi-violet: #6d40c5;
  --shapi-mint: #137a61;
  --shapi-amber: #a46b00;
}
html.shapi-light body { background: radial-gradient(900px 500px at 85% -10%, rgba(139, 92, 246, .1), transparent 66%), linear-gradient(135deg, #f8fcff, var(--shapi-ink)); }
html.shapi-light .swagger-ui .topbar { background: rgba(255, 255, 255, .88); box-shadow: 0 12px 34px rgba(45, 76, 102, .1); }
html.shapi-light .shapi-console-mark { color: var(--shapi-cyan); background: linear-gradient(145deg, rgba(34, 211, 238, .16), rgba(139, 92, 246, .15)); }
html.shapi-light .shapi-console-links a { background: rgba(255, 255, 255, .7); }
html.shapi-light .swagger-ui .scheme-container, html.shapi-light .swagger-ui .opblock { background: rgba(255, 255, 255, .76); box-shadow: 0 8px 26px rgba(45, 76, 102, .08); }
html.shapi-light .swagger-ui .opblock-body, html.shapi-light .swagger-ui .opblock-section-header { background: rgba(242, 249, 252, .75); }
html.shapi-light .swagger-ui .highlight-code, html.shapi-light .swagger-ui .microlight { color: #16334a; background: #eaf4f8; }
@media (max-width: 720px) { .swagger-ui .topbar .wrapper { flex-wrap: wrap; padding: 0 16px; }.shapi-console-brand { min-width: 0; }.swagger-ui .topbar .download-url-wrapper { order: 3; width: 100%; margin-left: 0; }.shapi-console-banner { align-items: flex-start; flex-direction: column; }.swagger-ui .information-container { padding-left: 16px; padding-right: 16px; }.swagger-ui .opblock { margin-left: 10px; margin-right: 10px; } }
`;

export const apiDocsJs = String.raw`
(function () {
  var STORAGE_KEY = 'shapi-api-theme';

  function readSavedTheme() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (_) {
      // Private browsing or a restrictive browser policy can disable storage.
    }
  }

  function applyTheme(theme) {
    var isLight = theme === 'light';
    document.documentElement.classList.toggle('shapi-light', isLight);
    var toggle = document.querySelector('[data-shapi-theme-toggle]');
    if (toggle) {
      toggle.textContent = isLight ? '☾ Dark mode' : '☼ Light mode';
      toggle.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
      toggle.setAttribute('aria-pressed', String(isLight));
    }
  }

  function mount() {
    var saved = readSavedTheme();
    applyTheme(saved === 'light' ? 'light' : 'dark');
    var wrapper = document.querySelector('.swagger-ui .topbar .wrapper');
    if (!wrapper) return false;

    if (!document.querySelector('.shapi-console-brand')) {
      var brand = document.createElement('div');
      brand.className = 'shapi-console-brand';
      brand.innerHTML = '<span class="shapi-console-mark">S</span><span><span class="shapi-console-name">SHAPI API</span><span class="shapi-console-subtitle">Behavioral assurance console</span></span>';
      wrapper.insertBefore(brand, wrapper.firstChild);
    }

    if (!document.querySelector('[data-shapi-theme-toggle]')) {
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'shapi-theme-toggle';
      toggle.dataset.shapiThemeToggle = 'true';
      toggle.addEventListener('click', function () {
        var next = document.documentElement.classList.contains('shapi-light') ? 'dark' : 'light';
        saveTheme(next);
        applyTheme(next);
      });
      wrapper.appendChild(toggle);
      applyTheme(saved === 'light' ? 'light' : 'dark');
    }

    var info = document.querySelector('.swagger-ui .information-container');
    if (info && !document.querySelector('.shapi-console-banner')) {
      var banner = document.createElement('div');
      banner.className = 'shapi-console-banner';
      banner.innerHTML = '<div class="shapi-console-banner-copy"><strong>Live API assurance surface</strong><span>Explore secured endpoints, inspect schemas, and test recovery signals.</span></div><nav class="shapi-console-links" aria-label="API quick links"><a href="/health">Health</a><a href="/ready">Readiness</a><a href="/docs/json">OpenAPI JSON</a></nav>';
      info.appendChild(banner);
    }
    return true;
  }

  var attempts = 0;
  var timer = window.setInterval(function () {
    if (mount() || ++attempts > 80) window.clearInterval(timer);
  }, 100);
})();
`;
