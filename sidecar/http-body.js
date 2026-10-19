/* sidecar/http-body.js — bounded HTTP request-body readers.

   The host has both JSON/text routes and binary audio routes. They share the same byte cap and clean 413
   behavior, but text must decode only after every Buffer is joined so a UTF-8 code point split across TCP
   chunks is not replaced. Kept dependency-free so routes can reuse it without importing the sidecar host. */
'use strict';

function payloadTooLarge(res) {
  try {
    if (res && !res.headersSent) {
      res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'request body too large' }));
    }
  } catch (_) {}
  const error = new Error('body too large');
  error.statusCode = 413;
  error.tooLarge = true;
  return error;
}

/* Past the cap we stop BUFFERING but keep READING (discarding the bytes) so the client finishes its upload and
   actually receives the answer. Destroying the request mid-upload reset the socket, and Chromium/WebView2 reported
   that as a bare "TypeError: Failed to fetch" with no status — a channel CONNECT carrying a large agent prompt
   read as a dead network, and the 413 (or the route's own error) never arrived (user report, 2026-10-15). A sender
   that keeps going DRAIN_CEILING bytes past the cap is still cut off, so an endless upload cannot pin the socket. */
const DRAIN_CEILING = 64 << 20;

function readBodyBuffer(req, max, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let over = false, cut = false;
    req.on('data', chunk => {
      if (over) {
        bytes += chunk.length;
        if (!cut && bytes > max + DRAIN_CEILING) { cut = true; try { req.destroy(); } catch (_) {} }
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > max) {
        over = true;
        chunks.length = 0;
        reject(payloadTooLarge(res));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', error => { if (!over) reject(error); });
  });
}

async function readBody(req, max, res) {
  return (await readBodyBuffer(req, max, res)).toString('utf8');
}

module.exports = { readBody, readBodyBuffer, DRAIN_CEILING };
