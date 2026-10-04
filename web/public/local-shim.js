/* Connects the Treechats page to the local server. It loads before the app so the app runs unchanged:
   - saving: the app's storage key is kept in memory and written to the server's database instead of
     the browser, so there is no 5 MB browser limit and your data lives in data/treechats.db
   - Claude: window.claude.use('sample') returns a client that sends requests through the server,
     which holds your API key.
   - signing in and the password lock: when this browser hasn't signed in yet, or Treechats is locked, it shows the
     sign-in or unlock screen instead of the app, and the app doesn't start until that is done. */
(function () {
  'use strict';
  var KEY = 'treechats-v1';
  /* this tab, so a notice about a change it made itself can be ignored */
  window.TREECHATS_TAB = Math.random().toString(36).slice(2);

  /* ---- the token ----
     Kept in localStorage, which browsers keep apart for each port, so no other local server can read it (a cookie
     would go to every port on localhost). Every request to the server carries it in the Authorization header. */
  var TOKEN_KEY = 'treechats-token', token = null;
  function readToken() { try { return window.localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function keepToken(t) { token = t || null; try { if (t) window.localStorage.setItem(TOKEN_KEY, t); else window.localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  window.TREECHATS_KEEP_TOKEN = keepToken;
  token = readToken();
  function xhr(method, url, body) {
    try {
      var x = new XMLHttpRequest();
      x.open(method, url, false);
      if (token) x.setRequestHeader('authorization', 'Bearer ' + token);
      if (body != null) x.setRequestHeader('content-type', 'application/json');
      x.send(body == null ? null : JSON.stringify(body));
      return x;
    } catch (e) { return null; }
  }
  function getSync(url) {
    var x = xhr('GET', url);
    return !x ? null : x.status === 200 ? x.responseText : x.status === 204 ? '' : null;
  }
  /* a sign-in link: ?token=… (printed in the terminal) or ?login=… (a one-time code from the link Treechats opens).
     Either is traded for the token, and taken out of the address bar. */
  (function () {
    var q = new URLSearchParams(location.search), t = q.get('token'), code = q.get('login');
    if (!t && !code) return;
    var x = xhr('POST', '/api/auth/login', t ? { token: t } : { code: code });
    try { if (x && x.status === 200) keepToken(JSON.parse(x.responseText).token); } catch (e) {}
    q.delete('token'); q.delete('login');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  })();
  /* same-origin requests to the server carry the token; a refused one (the token was reset, or Treechats locked)
     reloads the page into the sign-in or unlock screen, which also clears what it was showing */
  var rawFetch = window.fetch.bind(window), reloading = false;
  /* only this page's own origin (same port) ever gets the token */
  var isApi = function (url) { try { var u = new URL(String(url), location.href); return u.origin === location.origin && /^\/(api\/|mcp)/.test(u.pathname); } catch (e) { return false; } };
  window.fetch = function (input, init) {
    var url = typeof input === 'string' || input instanceof URL ? String(input) : (input && input.url) || '';
    if (token && isApi(url)) { init = Object.assign({}, init); var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {}); if (!h.has('authorization')) h.set('authorization', 'Bearer ' + token); init.headers = h; }
    return rawFetch(input, init).then(function (r) {
      if (!reloading && !window.TREECHATS_GATE && (r.status === 423 || r.status === 401) && isApi(url)) { reloading = true; location.reload(); }
      return r;
    });
  };
  /* EventSource can't send headers, so the event stream gets the token in its address (it never leaves this computer) */
  if (window.EventSource) {
    var RawES = window.EventSource;
    window.EventSource = function (url, opts) { if (token && isApi(String(url))) url += (String(url).indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(token); return new RawES(url, opts); };
    window.EventSource.prototype = RawES.prototype;
  }

  /* ---- signed in, and unlocked? ---- */
  var auth = null;
  try { auth = JSON.parse(getSync('/api/auth') || 'null'); } catch (e) { auth = null; }
  /* signed in by an older version's cookie: keep the token it hands over */
  if (auth && auth.token) keepToken(auth.token);
  if (auth && (!auth.authed || (auth.lock.on && !auth.lock.unlocked))) { gate(auth); return; }

  var cfgText = getSync('/api/config');
  var cfg = null;
  try { cfg = cfgText ? JSON.parse(cfgText) : null; } catch (e) { cfg = null; }
  window.TREECHATS_LOCAL = cfg || { offline: true };
  if (!cfg) return; /* opened without the server: the app falls back to browser storage and no Claude */

  /* ---- saving ---- */
  var mem = {};
  var saved = getSync('/api/state');
  if (saved) mem[KEY] = saved;
  else {
    /* first run: carry over anything this browser saved before */
    try { var old = window.localStorage.getItem(KEY); if (old) { mem[KEY] = old; put(old, function () { try { oRemove.call(window.localStorage, KEY); } catch (e) {} }); } } catch (e) {}
  }
  var inflight = null, queued = null, idle = [];
  /* resolves once everything saved so far has reached the server */
  window.TREECHATS_FLUSH = function () { return inflight || queued != null ? new Promise(function (r) { idle.push(r); }) : Promise.resolve(); };
  /* done: called once the server has it (used to delete the copy an older version kept in this browser) */
  function put(body, done) {
    if (inflight) { queued = body; return; }
    inflight = fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: body, keepalive: body.length < 60000 })
      .then(function (r) { if (!r.ok) throw new Error('save ' + r.status); window.TREECHATS_SAVE_ERROR = null; if (done) done(); })
      .catch(function (e) { window.TREECHATS_SAVE_ERROR = e; console.warn('Treechats could not save to the server:', e); })
      .then(function () { inflight = null; if (queued != null) { var q = queued; queued = null; put(q); } else { var w = idle; idle = []; w.forEach(function (f) { f(); }); } });
  }
  var proto = Storage.prototype, oGet = proto.getItem, oSet = proto.setItem, oRemove = proto.removeItem;
  proto.getItem = function (k) { return this === window.localStorage && k === KEY ? (k in mem ? mem[k] : null) : oGet.call(this, k); };
  proto.setItem = function (k, v) { if (this === window.localStorage && k === KEY) { mem[k] = String(v); put(mem[k]); return; } return oSet.call(this, k, v); };
  proto.removeItem = function (k) { if (this === window.localStorage && k === KEY) { delete mem[k]; return; } return oRemove.call(this, k); };

  /* ---- Claude ---- */
  function fail(code, text, message) {
    var e = new Error(message || code);
    e.code = code; e.text = text || '';
    return e;
  }
  function toBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); res({ mediaType: blob.type || 'image/png', data: s.slice(s.indexOf(',') + 1) }); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(blob);
    });
  }
  async function request(input, o) {
    o = o || {};
    var images = o.images && o.images.length ? await Promise.all(Array.from(o.images).map(toBase64)) : [];
    var res;
    try {
      res = await fetch('/api/sample', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: o.signal,
        body: JSON.stringify({ input: input, modelTier: o.modelTier, images: images, maxTokens: o.maxTokens, settings: o.settings })
      });
    } catch (e) { throw fail(e && e.name === 'AbortError' ? 'cancelled' : 'network', '', e && e.message); }
    if (!res.ok || !res.body) {
      var j = {}; try { j = await res.json(); } catch (e) {}
      throw fail(j.code || 'api_error', '', j.message);
    }
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', text = '', done = null;
    try {
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          var ev = JSON.parse(line);
          if (ev.t === 'text') { text += ev.d; if (o.onText) o.onText({ text: text, delta: ev.d }); }
          else if (ev.t === 'step' || ev.t === 'stepresult') { if (o.onStep) o.onStep(ev.t, ev.d); }
          else if (ev.t === 'done') done = ev;
          else if (ev.t === 'error') throw fail(ev.code, ev.text || text, ev.message);
        }
      }
    } catch (e) {
      /* a stopped request throws an AbortError, whose numeric code isn't one of ours */
      if (e && e.name === 'AbortError') throw fail('cancelled', text, '');
      if (e && typeof e.code === 'string') throw e;
      throw fail('network', text, e && e.message);
    }
    if (!done) throw fail('network', text, 'The reply ended early.');
    return { text: done.text, truncated: !!done.truncated, modelTierApplied: done.tier, model: done.model, usage: done.usage, notes: done.notes || [], thinking: done.thinking || '', steps: done.steps || null, sources: done.sources || null };
  }

  /* the reply as JSON: the whole reply, else a code fence, else from the first { or [ to the last } or ] */
  function parseLoose(t) {
    var s = String(t).trim();
    try { return JSON.parse(s); } catch (e) {}
    var f = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (f) { try { return JSON.parse(f[1]); } catch (e) {} }
    var a = s.search(/[\[{]/), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
    throw fail('invalid_json', t, 'The reply was not JSON.');
  }

  function sample(input, o) { return request(input, o); }
  sample.json = async function (input, o) {
    var hint = '\n\nYour reply will be read by a program: reply with the JSON only.';
    var inp = typeof input === 'string' ? input + hint : input.map(function (t, i) { return i === input.length - 1 ? { role: t.role, content: t.content + hint } : t; });
    var r = await request(inp, o);
    if (r.truncated) throw fail('invalid_json', r.text, 'The reply was cut short.');
    return parseLoose(r.text);
  };
  sample.limits = async function () {
    return { maxPromptBytes: cfg.limits.maxPromptBytes, images: { maxCount: 20, maxInputBytes: 5 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] } };
  };

  window.claude = {
    use: function (name) { return Promise.resolve(name === 'sample' && cfg.hasKey ? sample : null); }
  };

  /* ---- while you're using the page, the auto-lock waits (reading counts, not only saving) ---- */
  var lastPing = Date.now();
  function alive() {
    if (!cfg.lock || !cfg.lock.password || !cfg.lock.autoLock || Date.now() - lastPing < 60000) return;
    lastPing = Date.now();
    window.fetch('/api/vault/alive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(function () {});
  }
  ['pointerdown', 'keydown', 'wheel'].forEach(function (t) { window.addEventListener(t, alive, { passive: true, capture: true }); });

  /* ---- the sign-in and unlock screen ---- */
  function gate(a) {
    window.TREECHATS_GATE = a;
    window.TREECHATS_LOCAL = { offline: true, gated: true };
    var css = ':root{--g-bg:#f6f5f1;--g-card:#fff;--g-fg:#1d1d1b;--g-muted:#6b6a64;--g-line:#dcdad2;--g-acc:#2f5fd0;--g-err:#b3261e}' +
      '@media (prefers-color-scheme:dark){:root{--g-bg:#151614;--g-card:#1f201d;--g-fg:#ecebe6;--g-muted:#a3a29b;--g-line:#3a3b36;--g-acc:#8fb0ff;--g-err:#ffb4ab}}' +
      'html,body{margin:0;height:100%;overflow:hidden}body>*:not(#tcgate){display:none!important}' +
      '#tcgate{position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:var(--g-bg);color:var(--g-fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;z-index:2147483647;overflow:auto}' +
      '#tcgate form{width:min(400px,100%);background:var(--g-card);border:1px solid var(--g-line);border-radius:14px;padding:26px 24px;display:grid;gap:12px;box-shadow:0 8px 30px rgba(0,0,0,.08)}' +
      '#tcgate h1{font-size:1.25rem;margin:0}#tcgate p{margin:0;color:var(--g-muted);font-size:.9rem}' +
      '#tcgate label{display:grid;gap:4px;font-size:.85rem;font-weight:600}' +
      '#tcgate input{font:inherit;padding:9px 11px;border-radius:8px;border:1px solid var(--g-line);background:var(--g-bg);color:var(--g-fg)}' +
      '#tcgate input:focus{outline:2px solid var(--g-acc);outline-offset:1px}' +
      '#tcgate button{font:inherit;cursor:pointer}#tcgate .go{padding:10px;border-radius:8px;border:0;background:var(--g-acc);color:var(--g-card);font-weight:600}' +
      '#tcgate .go:disabled{opacity:.6;cursor:wait}#tcgate .alt{border:0;background:none;color:var(--g-acc);padding:0;justify-self:start;font-size:.85rem}' +
      '#tcgate .err{color:var(--g-err);font-size:.85rem;min-height:1.2em}#tcgate code{font-size:.85em}';
    /* encrypted without a password and the key isn't in this computer's keychain: only the recovery key opens it */
    var mode = !a.lock.on || (a.authed && a.lock.unlocked) ? 'token' : a.lock.password ? 'password' : a.lock.unlocked ? 'token' : 'recovery';
    function html() {
      if (mode === 'password') return (a.lock.unlocked ? '<h1>Sign in to Treechats</h1><p>Enter your Treechats password to use it in this browser.</p>' : '<h1>Treechats is locked</h1><p>Enter your password to open your chats.</p>') +
        '<label>Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>' +
        '<div class="err" role="alert"></div><button class="go">Unlock</button>' +
        '<button type="button" class="alt" data-mode="recovery">Forgot it? Use your recovery key</button>' +
        (a.authed ? '' : '<button type="button" class="alt" data-mode="token">Sign in with the token instead</button>');
      if (mode === 'recovery' && !a.lock.password) return '<h1>Enter your recovery key</h1><p>Your Treechats data is encrypted, and its key isn’t in this computer’s keychain (a different computer, or a reinstalled system, say). The recovery key is the code you saved when you turned encryption on.</p>' +
        '<label>Recovery key<input name="recovery" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required autofocus></label>' +
        '<div class="err" role="alert"></div><button class="go">Open</button>' +
        (a.authed ? '' : '<button type="button" class="alt" data-mode="token">Sign in with the token instead</button>');
      if (mode === 'recovery') return '<h1>Use your recovery key</h1><p>The code you saved when you turned the lock on. Then choose a new password.</p>' +
        '<label>Recovery key<input name="recovery" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" required autofocus></label>' +
        '<label>New password<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required></label>' +
        '<label>New password again<input type="password" name="again" autocomplete="new-password" minlength="8" required></label>' +
        '<div class="err" role="alert"></div><button class="go">Unlock and set password</button>' +
        '<button type="button" class="alt" data-mode="password">Back</button>';
      return '<h1>Sign in to Treechats</h1><p>Open Treechats from the link it printed in the terminal when it started (it ends in <code>?token=…</code>). Or paste the token here. It is also in the file named <code>token</code> in Treechats’ data folder.</p>' +
        '<label>Token<input name="token" autocomplete="off" spellcheck="false" required autofocus></label>' +
        '<div class="err" role="alert"></div><button class="go">Sign in</button>' +
        (a.lock.password ? '<button type="button" class="alt" data-mode="password">Use the password instead</button>' : '');
    }
    function show() {
      var root = document.getElementById('tcgate');
      if (!root) {
        var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
        root = document.createElement('div'); root.id = 'tcgate'; document.body.appendChild(root);
        root.addEventListener('click', function (e) { var b = e.target.closest('[data-mode]'); if (b) { mode = b.dataset.mode; show(); } });
        root.addEventListener('submit', submit);
      }
      root.innerHTML = '<form novalidate>' + html() + '</form>';
      var f = root.querySelector('input'); if (f) f.focus();
    }
    function submit(e) {
      e.preventDefault();
      var f = e.target, err = f.querySelector('.err'), go = f.querySelector('.go'), v = function (n) { return f.elements[n] ? f.elements[n].value : ''; };
      var url, body;
      if (mode === 'token') { url = '/api/auth/login'; body = { token: v('token') }; }
      else if (mode === 'password') { url = '/api/vault/unlock'; body = { password: v('password') }; }
      else if (!a.lock.password) { url = '/api/vault/unlock'; body = { recovery: v('recovery') }; }
      else {
        if (v('newPassword') !== v('again')) { err.textContent = 'The two passwords don’t match.'; return; }
        url = '/api/vault/unlock'; body = { recovery: v('recovery'), newPassword: v('newPassword') };
      }
      go.disabled = true; err.textContent = '';
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (x) {
          if (x.ok) {
            if (x.d.token) keepToken(x.d.token);
            if (x.d.warning) { try { sessionStorage.setItem('treechats-warning', x.d.warning); } catch (e) {} }
            /* signed in with the token, but locked: the password (or recovery key) is still needed */
            if (mode === 'token' && a.lock.on && !a.lock.unlocked) { a.authed = true; mode = a.lock.password ? 'password' : 'recovery'; show(); return; }
            location.reload(); return;
          }
          go.disabled = false; err.textContent = x.d.message || 'That didn’t work.';
          var i = f.querySelector('input'); if (i && x.d.code !== 'weak_password') { i.select(); i.focus(); }
        })
        .catch(function () { go.disabled = false; err.textContent = 'Treechats isn’t answering. Is it still running?'; });
    }
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    /* signed in from another tab (a new token kept there): this one follows */
    window.addEventListener('storage', function (e) { if (e.key === TOKEN_KEY && e.newValue) location.reload(); });
  }
})();
