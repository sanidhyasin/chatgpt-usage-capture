/*
 * background.js  (MV3 service worker)
 * Persists captured records in chrome.storage.local and serves the popup.
 * Storage only — no network.
 */
var MAX = 200;

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === 'cgpt-record' && msg.record) {
    chrome.storage.local.get({ records: [] }, function (data) {
      var arr = data.records || [];
      arr.unshift(msg.record);
      if (arr.length > MAX) arr.length = MAX;
      chrome.storage.local.set({ records: arr });
    });
    return; // no async response needed
  }

  if (msg.type === 'cgpt-get') {
    chrome.storage.local.get({ records: [] }, function (data) {
      sendResponse(data.records || []);
    });
    return true; // keep the message channel open for async sendResponse
  }

  if (msg.type === 'cgpt-clear') {
    chrome.storage.local.set({ records: [] }, function () { sendResponse(true); });
    return true;
  }
});
