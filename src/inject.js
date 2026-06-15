/*
 * inject.js  (MAIN world, runs at document_start)
 * Overrides window.fetch before ChatGPT's own JS loads, observes the conversation
 * stream, reassembles it, and emits start/progress/final events to the isolated
 * content script via window.postMessage. No chrome.* APIs here (MAIN world can't
 * see them) and the extension never makes its own network calls.
 */
(function () {
  if (window.__cgptCaptureInstalled) return;
  window.__cgptCaptureInstalled = true;

  var CONV_RE = /\/backend-api\/(?:[^?#]*\/)?conversation(?:\?|$|\/|#)/;
  var origFetch = window.fetch;
  var seq = 0;

  // DEBUG: collect raw SSE payloads so we can fix the parser against the live format.
  // Toggle off later by setting window.__cgptDebug = false in the page console.
  window.__cgptDebug = (window.__cgptDebug !== false);
  var RAW_CAP = 200; // max raw events kept per capture

  function post(kind, payload) {
    try {
      payload = payload || {};
      payload.source = 'cgpt-capture';
      payload.kind = kind;
      window.postMessage(payload, '*');
    } catch (e) { /* ignore */ }
  }

  function approxTokens(s) { return s ? Math.max(1, Math.ceil(s.length / 4)) : 0; }

  function extractPromptFromBody(bodyStr) {
    try {
      if (!bodyStr || typeof bodyStr !== 'string') return { prompt: null, model: null };
      var j = JSON.parse(bodyStr);
      var model = j.model || null;
      if (Array.isArray(j.messages)) {
        for (var i = j.messages.length - 1; i >= 0; i--) {
          var m = j.messages[i];
          if (m && m.author && m.author.role === 'user' && m.content && Array.isArray(m.content.parts)) {
            var prompt = m.content.parts
              .map(function (p) { return typeof p === 'string' ? p : JSON.stringify(p); })
              .join('\n');
            return { prompt: prompt, model: model };
          }
        }
      }
      return { prompt: null, model: model };
    } catch (e) { return { prompt: null, model: null }; }
  }

  async function readBody(args) {
    try {
      var b = args[1] && args[1].body;
      if (typeof b === 'string') return b;
    } catch (e) {}
    try {
      var req = args[0];
      if (req && typeof req === 'object' && typeof req.clone === 'function') {
        return await req.clone().text();
      }
    } catch (e) {}
    return null;
  }

  async function parseStream(response, id, info) {
    try {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var re = window.__CGPTReassembler.create();
      var buffer = '';
      var lastEmitLen = -1;
      var rawCount = 0;

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (var i = 0; i < events.length; i++) rawCount = feedEvent(events[i], re, id, rawCount);
        var t = re.getText();
        if (t.length !== lastEmitLen) {
          lastEmitLen = t.length;
          post('progress', { id: id, response: t, model: re.getModel() });
        }
      }
      if (buffer.trim()) rawCount = feedEvent(buffer, re, id, rawCount);

      var responseText = re.getText();
      var record = {
        id: id,
        time: Date.now(),
        model: re.getModel() || (info && info.model) || null,
        prompt: (info && info.prompt) || null,
        response: responseText,
        promptTokensApprox: approxTokens(info && info.prompt),
        responseTokensApprox: approxTokens(responseText)
      };
      post('final', { id: id, record: record });
    } catch (e) {
      post('final', { id: id, record: { id: id, time: Date.now(), error: String(e) } });
    }
  }

  function feedEvent(eventText, re, id, rawCount) {
    if (!eventText) return rawCount;
    var lines = eventText.split('\n');
    var data = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('data:') === 0) {
        data += (line.charAt(5) === ' ') ? line.slice(6) : line.slice(5);
      }
    }
    if (!data) return rawCount;
    if (window.__cgptDebug && rawCount < RAW_CAP) {
      post('raw', { id: id, data: data });
      rawCount++;
    }
    re.feed(data);
    return rawCount;
  }

  window.fetch = async function () {
    var args = Array.prototype.slice.call(arguments);
    var url = '';
    var method = 'GET';
    try {
      if (typeof args[0] === 'string') url = args[0];
      else if (args[0] && args[0].url) url = args[0].url;
      method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET';
    } catch (e) {}

    var isConvUrl = CONV_RE.test(url) && String(method).toUpperCase() === 'POST';
    var capture = false, id = null, info = null;

    if (isConvUrl) {
      var bodyStr = await readBody(args);
      info = extractPromptFromBody(bodyStr);
      // Only treat it as a real turn if there's an actual user prompt. This filters
      // out ChatGPT's other POSTs to /conversation (title-gen, feedback, etc.).
      if (info.prompt) {
        capture = true;
        id = 'cap_' + Date.now() + '_' + (seq++);
        post('start', { id: id, prompt: info.prompt, model: info.model, time: Date.now() });
      }
    }

    var response = await origFetch.apply(this, args);

    if (capture && response && response.body) {
      try { parseStream(response.clone(), id, info); }
      catch (e) { /* never break the page */ }
    }

    return response;
  };

  try { console.debug('[Oximy AI] fetch hook installed (debug=' + window.__cgptDebug + ')'); } catch (e) {}
})();
