function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}
function trim(s, n) { s = s || ''; n = n || 280; return s.length > n ? s.slice(0, n) + '…' : s; }

var listEl = document.getElementById('list');
var current = [];

function render(records) {
  current = records || [];
  if (!current.length) { listEl.innerHTML = '<div class="empty">No captures yet.</div>'; return; }
  listEl.innerHTML = current.map(function (r) {
    return '<div class="rec">' +
      '<div class="row"><span class="k">time</span><span class="v">' + esc(new Date(r.time).toLocaleString()) + '</span></div>' +
      '<div class="row"><span class="k">model</span><span class="v">' + esc(r.model || '—') + '</span></div>' +
      '<div class="row"><span class="k">prompt</span><span class="v">' + esc(trim(r.prompt)) + '</span></div>' +
      '<div class="row"><span class="k">resp</span><span class="v resp">' + esc(trim(r.response)) + '</span></div>' +
      '<div class="row"><span class="k">~tok</span><span class="v">p:' + (r.promptTokensApprox || 0) + ' · r:' + (r.responseTokensApprox || 0) + '</span></div>' +
    '</div>';
  }).join('');
}

chrome.runtime.sendMessage({ type: 'cgpt-get' }, function (records) { render(records); });

document.getElementById('export').addEventListener('click', function () {
  var blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'ai-chat-captures.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clear').addEventListener('click', function () {
  chrome.runtime.sendMessage({ type: 'cgpt-clear' }, function () { render([]); });
});
