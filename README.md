# AI Chat Capture (ChatGPT)

A small Chrome (MV3) extension that observes ChatGPT's **own** network stream from
inside the page and reconstructs a clean `prompt / response / model / ~tokens`
record — **live, token by token** — in a floating panel. Nothing leaves the machine;
the extension makes no network calls of its own, it only watches the site's traffic.

A working demo of the "reading from inside the browser" problem: tee the browser's own
network calls and reassemble the partial token-by-token deltas into a clean record.

> Scope: ChatGPT only, the user's own browser, for a consented demo. Not for distribution.

## How it works (short version)

- A MAIN-world script (`src/inject.js`) overrides `window.fetch` at `document_start`,
  before ChatGPT's JS loads.
- On a POST to `…/backend-api/…/conversation` it reads the prompt from the request body,
  **clones** the response (so the page is untouched), and reads the clone's stream.
- `src/reassembler.js` turns the SSE events into the full answer. It handles both
  ChatGPT formats: older full snapshots and newer append/JSON-patch deltas.
- `src/content.js` (isolated world) draws the live panel and saves the final record via
  the service worker (`src/background.js`) into `chrome.storage.local`.
- The toolbar popup (`popup.html`) lists captures and exports JSON.

## Run the tests first (no browser needed)

Proves the reconstruction logic works against both stream formats:

```bash
cd chatgpt-extension
node test/run.js
```

Expect `12 passed, 0 failed`.

## Load it in Chrome

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `chatgpt-extension/` folder.
4. Open **https://chatgpt.com**, send a message.
5. A panel appears bottom-right and reconstructs the turn live. Click **Copy JSON**, or
   open the extension popup to **Export JSON**.

## If a capture doesn't trigger

ChatGPT changes its internals over time. Two quick checks:
- Open DevTools → **Network**, send a message, and confirm the request path. If it isn't
  `…/backend-api/…/conversation`, update `CONV_RE` in `src/inject.js`.
- If the panel shows the prompt but the response stays empty, the stream format changed.
  Copy a few `data:` lines from that response into a new file under `test/fixtures/`,
  add a case to `test/run.js`, and extend `src/reassembler.js`. (This iterate-on-real-
  payloads loop is exactly the "replay harness" idea from the doc.)

## Files

```
chatgpt-extension/
  manifest.json        MV3 config (MAIN + isolated content scripts, storage)
  src/
    reassembler.js     pure SSE→record reconstruction (tested in Node)
    inject.js          MAIN world: fetch hook, stream read, emits events
    content.js         isolated world: live panel + relay to service worker
    panel.css          panel styling
    background.js       service worker: stores records
  popup.html / popup.js   list + export captures
  test/
    run.js             Node test harness
    fixtures/          sample snapshot + delta streams
```
