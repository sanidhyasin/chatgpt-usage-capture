/*
 * content.js  (ISOLATED world)
 * Receives capture events from inject.js via window.postMessage, renders the live
 * floating panel, and relays final records to the service worker for storage.
 * Also collects raw SSE payloads (debug) so we can fix the parser against the live
 * format — the "Copy raw" button copies the most recent capture's raw events.
 */
(function () {
  var records = {};
  var rawEvents = {}; // id -> [raw data strings]
  var lastId = null;
  var captures = 0;
  var panel, bodyEl, statusEl, countEl;

  function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function trim(s, n) { s = s || ''; n = n || 600; return s.length > n ? s.slice(0, n) + '…' : s; }
  function approx(s) { return s ? Math.max(1, Math.ceil(s.length / 4)) : 0; }

  function ensurePanel() {
    if (panel) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', ensurePanel); return; }
    panel = document.createElement('div');
    panel.id = 'cgpt-capture-panel';
    panel.innerHTML =
      '<div id="cgpt-cap-header">' +
        '<span id="cgpt-cap-title">Oximy AI</span>' +
        '<span id="cgpt-cap-count" title="captures this session">0</span>' +
        '<button id="cgpt-cap-min" title="minimize">–</button>' +
      '</div>' +
      '<div id="cgpt-cap-body"><div id="cgpt-cap-empty">Send a message in ChatGPT…</div></div>' +
      '<div id="cgpt-cap-footer">' +
        '<span id="cgpt-cap-status">idle</span>' +
        '<button id="cgpt-cap-raw" title="copy raw SSE of the latest turn (debug)">Copy raw</button>' +
        '<button id="cgpt-cap-copy">Copy JSON</button>' +
      '</div>';
    document.body.appendChild(panel);
    bodyEl = panel.querySelector('#cgpt-cap-body');
    statusEl = panel.querySelector('#cgpt-cap-status');
    countEl = panel.querySelector('#cgpt-cap-count');
    panel.querySelector('#cgpt-cap-min').addEventListener('click', function () {
      panel.classList.toggle('cgpt-min');
    });
    panel.querySelector('#cgpt-cap-copy').addEventListener('click', function () {
      var all = Object.keys(records).map(function (k) { return records[k]; });
      var out = all.length === 1 ? all[0] : all;
      try {
        navigator.clipboard.writeText(JSON.stringify(out, null, 2));
        statusEl.textContent = 'copied JSON ✓';
      } catch (e) { statusEl.textContent = 'copy failed'; }
    });
    panel.querySelector('#cgpt-cap-raw').addEventListener('click', function () {
      var list = (lastId && rawEvents[lastId]) || [];
      if (!list.length) { statusEl.textContent = 'no raw events'; return; }
      var text = list.map(function (d) { return 'data: ' + d; }).join('\n\n');
      try {
        navigator.clipboard.writeText(text);
        statusEl.textContent = 'copied ' + list.length + ' raw events ✓';
      } catch (e) { statusEl.textContent = 'copy failed'; }
    });
  }

  function renderRecord(id) {
    ensurePanel();
    if (!bodyEl) return;
    var r = records[id];
    if (!r) return;
    var empty = bodyEl.querySelector('#cgpt-cap-empty');
    if (empty) empty.remove();
    var card = bodyEl.querySelector('[data-id="' + id + '"]');
    if (!card) {
      card = document.createElement('div');
      card.className = 'cgpt-cap-card';
      card.setAttribute('data-id', id);
      bodyEl.insertBefore(card, bodyEl.firstChild);
    }
    var cursor = r.final ? '' : '<span class="cgpt-cap-cursor">▋</span>';
    card.innerHTML =
      '<div class="cgpt-cap-row"><span class="cgpt-cap-k">model</span><span class="cgpt-cap-v">' + esc(r.model || '…') + '</span></div>' +
      '<div class="cgpt-cap-row"><span class="cgpt-cap-k">prompt</span><span class="cgpt-cap-v">' + esc(trim(r.prompt, 300)) + '</span></div>' +
      '<div class="cgpt-cap-row"><span class="cgpt-cap-k">response</span><span class="cgpt-cap-v cgpt-cap-resp">' + esc(trim(r.response)) + cursor + '</span></div>' +
      '<div class="cgpt-cap-row"><span class="cgpt-cap-k">~tokens</span><span class="cgpt-cap-v">p:' + (r.promptTokensApprox || approx(r.prompt)) + ' · r:' + (r.responseTokensApprox || approx(r.response)) + '</span></div>';
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'cgpt-capture') return;

    if (d.kind === 'start') {
      records[d.id] = { id: d.id, model: d.model, prompt: d.prompt, response: '', time: d.time, final: false };
      rawEvents[d.id] = [];
      lastId = d.id;
      captures++;
      ensurePanel();
      if (countEl) countEl.textContent = String(captures);
      if (statusEl) statusEl.textContent = 'capturing…';
      renderRecord(d.id);
    } else if (d.kind === 'raw') {
      if (!rawEvents[d.id]) rawEvents[d.id] = [];
      rawEvents[d.id].push(d.data);
    } else if (d.kind === 'progress') {
      var r = records[d.id];
      if (!r) { records[d.id] = r = { id: d.id, prompt: null, response: '', final: false }; }
      r.response = d.response;
      if (d.model) r.model = d.model;
      renderRecord(d.id);
    } else if (d.kind === 'final') {
      var prev = records[d.id] || {};
      records[d.id] = Object.assign(prev, d.record, { final: true });
      renderRecord(d.id);
      if (statusEl) statusEl.textContent = 'captured ✓';
      try { chrome.runtime.sendMessage({ type: 'cgpt-record', record: records[d.id] }); } catch (e2) {}
    }
  });

  ensurePanel();
})();
