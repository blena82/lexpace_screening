// LexPace village on Streamlit: the pages run inside a Streamlit component, where there is no HTTP
// server for /api/screening. This sends those requests to the Streamlit app (Python) through the
// component channel and hands the replies back as normal fetch responses. Loaded before
// journey-api.js; the station code and the village are unchanged.
(function () {
  'use strict';

  const TIMEOUT_MS = 200000; // longer than the server's own limit, so a lost connection still ends in "Try again"
  const send = (type, data) => window.parent.postMessage({ isStreamlitMessage: true, type, ...data }, '*');
  const waiting = new Map(); // request id -> { req, resolve, reject }

  // The component's value: every request still waiting for its reply (Python answers each id once).
  function publish() {
    send('streamlit:setComponentValue', { dataType: 'json', value: { outbox: [...waiting.values()].map((w) => w.req) } });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || e.data.type !== 'streamlit:render') return;
    const replies = (e.data.args || {}).replies || {};
    Object.keys(replies).forEach((id) => {
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      const r = replies[id];
      w.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
    });
  });

  const pageFetch = window.fetch.bind(window);
  window.fetch = function (url, init) {
    if (typeof url !== 'string' || !url.startsWith('/api/screening/')) return pageFetch(url, init);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const req = { id, method: (init && init.method) || 'GET', path: url, body: init && init.body ? JSON.parse(init.body) : null };
    return new Promise((resolve, reject) => {
      waiting.set(id, { req, resolve, reject });
      publish();
      setTimeout(() => { if (waiting.delete(id)) reject(new Error('No reply from LexPace')); }, TIMEOUT_MS);
    });
  };

  send('streamlit:componentReady', { apiVersion: 1 });
  send('streamlit:setFrameHeight', { height: 900 }); // the Streamlit app stretches the frame to the window
})();
