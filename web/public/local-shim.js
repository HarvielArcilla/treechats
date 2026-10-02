/* Connects the Treechats page to the local server. It loads before the app so the app runs unchanged:
   - saving: the app's storage key is kept in memory and written to the server's database instead of
     the browser, so there is no 5 MB browser limit and your data lives in data/treechats.db
   - Claude: window.claude.use('sample') returns a client that sends requests through the server,
     which holds your API key. */
(function () {
  'use strict';
  var KEY = 'treechats-v1';

  function getSync(url) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url, false);
      x.send();
      return x.status === 200 ? x.responseText : x.status === 204 ? '' : null;
    } catch (e) { return null; }
  }

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
    try { var old = window.localStorage.getItem(KEY); if (old) { mem[KEY] = old; put(old); } } catch (e) {}
  }
  var inflight = null, queued = null;
  function put(body) {
    if (inflight) { queued = body; return; }
    inflight = fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: body, keepalive: body.length < 60000 })
      .then(function (r) { if (!r.ok) throw new Error('save ' + r.status); window.TREECHATS_SAVE_ERROR = null; })
      .catch(function (e) { window.TREECHATS_SAVE_ERROR = e; console.warn('Treechats could not save to the server:', e); })
      .then(function () { inflight = null; if (queued != null) { var q = queued; queued = null; put(q); } });
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
        body: JSON.stringify({ input: input, modelTier: o.modelTier, images: images, maxTokens: o.maxTokens })
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
          else if (ev.t === 'done') done = ev;
          else if (ev.t === 'error') throw fail(ev.code, ev.text || text, ev.message);
        }
      }
    } catch (e) {
      if (e && e.code) throw e;
      throw fail(e && e.name === 'AbortError' ? 'cancelled' : 'network', text, e && e.message);
    }
    if (!done) throw fail('network', text, 'The reply ended early.');
    return { text: done.text, truncated: !!done.truncated, modelTierApplied: done.tier, model: done.model, usage: done.usage };
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
})();
