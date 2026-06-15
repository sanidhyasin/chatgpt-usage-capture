/*
 * reassembler.js
 * Pure, browser-free module that turns ChatGPT's streamed SSE events into a clean
 * { text, model, finished } record. Used by inject.js (MAIN world) and by the Node
 * test harness (test/run.js).
 *
 * Verified against the real chatgpt.com stream (see test/fixtures/real_gpt5.txt),
 * plus older formats. Shapes handled:
 *   - protocol marker:        "v1"                                  (ignored)
 *   - typed control events:   {"type":"message_marker"|...}         (ignored)
 *   - user echo:              {"type":"input_message",...}          (ignored)
 *   - root snapshot:          {"p":"","o":"add","v":{"message":{...}}}
 *   - content append:         {"p":"/message/content/parts/0","o":"append","v":"tok"}
 *   - bare continuation:      {"v":"tok"}        (append to last *content* path)
 *   - patch arrays:           {"p":"","o":"patch","v":[ ...ops... ]}
 *   - status/end_turn -> finish;  model_slug -> model
 *   - older full snapshots:   {"message":{...,"content":{"parts":["text so far"]}}}
 *   - [DONE] sentinel
 *
 * Hard rule: the response text is ONLY ever modified for a content/parts path. A
 * non-content path (e.g. /message/status) must never leak into the response.
 */
(function (root) {
  function create() {
    var text = '';
    var model = null;
    var lastContentPath = '/message/content/parts/0';
    var finished = false;

    function isPartsPath(p) { return typeof p === 'string' && /\/content\/parts\/\d+/.test(p); }
    function isModelPath(p) { return typeof p === 'string' && /model_slug/.test(p); }

    // ChatGPT wraps web-search citations in private-use unicode markers
    // (U+E200 ... U+E201, e.g. "cite turn0search7") that the web UI renders as
    // "Sources" chips. Strip them so the captured text reads cleanly.
    function clean(s) {
      if (!s) return s;
      return s
        .replace(/\uE200[\s\S]*?\uE201/g, "") // whole citation blocks
        .replace(/[\uE200-\uE2FF]/g, "");       // any stray markers
    }

    function setFromMessage(m) {
      var changed = false;
      if (!m || typeof m !== 'object') return changed;
      if (m.content && Array.isArray(m.content.parts)) {
        var joined = m.content.parts.map(function (x) { return typeof x === 'string' ? x : ''; }).join('');
        // snapshots only grow; never let a stray short snapshot truncate us
        if (joined.length >= text.length && joined !== text) { text = joined; changed = true; }
      }
      var ms = (m.metadata && (m.metadata.model_slug || m.metadata.resolved_model_slug)) || m.model_slug;
      if (ms && ms !== model) { model = ms; changed = true; }
      if (m.end_turn === true || (m.metadata && m.metadata.finish_details)) finished = true;
      return changed;
    }

    function applyOp(op) {
      if (!op || typeof op !== 'object') return false;
      var changed = false;

      // patch bundle: {"o":"patch","v":[ ...ops... ]}
      if (op.o === 'patch' && Array.isArray(op.v)) {
        for (var i = 0; i < op.v.length; i++) { if (applyOp(op.v[i])) changed = true; }
        return changed;
      }

      var hasPath = (op.p !== undefined && op.p !== null);

      // root op: add/replace the whole message object (initial assistant snapshot)
      if (hasPath && op.p === '') {
        if (op.v && typeof op.v === 'object' && (op.v.message || (op.v.author && op.v.content))) {
          if (setFromMessage(op.v.message || op.v)) changed = true;
        }
        return changed;
      }

      var target = hasPath ? op.p : lastContentPath; // bare {"v"} continues last content path
      if (hasPath && isPartsPath(op.p)) lastContentPath = op.p; // only content paths anchor continuations
      var o = op.o || (op.v !== undefined ? 'append' : null);
      var v = op.v;

      // a message snapshot delivered as a value, e.g. {"v":{"message":{...}}} with no path
      if (v && typeof v === 'object' && (v.message || (v.author && v.content))) {
        if (setFromMessage(v.message || v)) changed = true;
        return changed;
      }

      // response text is touched ONLY for content/parts paths
      if (isPartsPath(target) && typeof v === 'string') {
        if (o === 'append' || o === null) { text += v; changed = true; }
        else if (o === 'replace' || o === 'add') { text = v; changed = true; }
      }

      if (isModelPath(target) && typeof v === 'string' && v !== model) { model = v; changed = true; }
      if (/\/(end_turn|status)$/.test(String(target))) {
        if (v === true || v === 'finished_successfully') finished = true;
      }
      if (/finish_details/.test(String(target)) && v != null) finished = true;
      return changed;
    }

    function handle(json) {
      if (json == null || typeof json !== 'object') return false; // ignores "v1" etc.
      // typed control events we don't care about
      if (json.type && !json.message && json.v === undefined && json.p === undefined) return false;
      // older raw message or {"message":{...}} wrapper (snapshot streams)
      if (json.message || (json.author && json.content)) {
        return setFromMessage(json.message || json);
      }
      if (Array.isArray(json)) {
        var c = false;
        for (var i = 0; i < json.length; i++) { if (applyOp(json[i])) c = true; }
        return c;
      }
      if (json.o !== undefined || json.p !== undefined || json.v !== undefined) {
        return applyOp(json);
      }
      return false;
    }

    return {
      feed: function (dataStr) {
        if (dataStr === '[DONE]') { finished = true; return { changed: false, finished: true }; }
        var json;
        try { json = JSON.parse(dataStr); } catch (e) { return { changed: false, finished: finished }; }
        var changed = handle(json);
        return { changed: changed, finished: finished };
      },
      getText: function () { return clean(text); },
      getModel: function () { return model; },
      isFinished: function () { return finished; }
    };
  }

  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  root.__CGPTReassembler = api;
})(typeof window !== 'undefined' ? window : globalThis);
