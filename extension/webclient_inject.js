// ============================================================
// webclient_inject.js — page context injector for team.3cx.com
//
// INBOUND CALLS — via Angular Service Worker push notifications
//   Angular NGSW (ngsw-worker.js) handles the Web Push event
//   and broadcasts it to all open page clients via postMessage.
//   We intercept that broadcast on navigator.serviceWorker.
//   Fallback: wrap ServiceWorkerRegistration.showNotification
//   and parse the notification title/body for phone numbers.
//
// OUTBOUND CALLS — via WebSocket
//   Patched WebSocket watches for connected/ended states.
//   (Outbound HAR had 0 HTTP entries — pure WS traffic.)
//
// Neither block shares code with MyCXFAVEVClient.
// ============================================================

(function () {
  'use strict';

  // ── 1. Angular NGSW Service Worker message interception ────────────────────
  // NGSW broadcasts push data to page clients immediately after receiving push.
  // Message structure: { type: 'PUSH', data: { notification: {...}, data: {...} } }
  // or: { type: 'PUSH', data: { title, body, data: { callerNumber, ... } } }

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function (evt) {
      try {
        const msg = evt.data;
        if (!msg || typeof msg !== 'object') return;

        // Angular NGSW push broadcast
        if (msg.type === 'PUSH' || msg.type === 'NOTIFICATION_CLICK') {
          const number = extractFromPushPayload(msg);
          if (number) {
            fire('__3cx_prm_call', { number, source: 'sw_push' });
            return;
          }
        }

        // Some 3CX versions use a custom message type
        const str = JSON.stringify(msg).toLowerCase();
        if (str.includes('ring') || str.includes('incoming') || str.includes('alerting')) {
          const number = extractCallerNumber(msg);
          if (number) fire('__3cx_prm_call', { number, source: 'sw_message' });
        }
      } catch (e) {}
    });
  }

  // ── 2. ServiceWorkerRegistration.showNotification intercept ────────────────
  // Backup path: the Angular SW calls self.registration.showNotification().
  // We patch the prototype here in page context — Chrome shares the prototype
  // between page and SW in the same origin for Notification-related APIs.
  // If the SW shows a notification, we extract the caller from title/body/data.

  if (typeof ServiceWorkerRegistration !== 'undefined') {
    const origShow = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      try {
        // Look for phone number in notification data fields first
        const data    = options?.data ?? {};
        const body    = options?.body ?? '';
        const number  = extractCallerNumber(data)
                     || extractFromString(title)
                     || extractFromString(body);

        if (number) {
          fire('__3cx_prm_call', { number, source: 'show_notification',
            title, body });
        }
      } catch (e) {}
      return origShow.apply(this, arguments);
    };
  }

  // ── 3. Notification constructor intercept (fallback) ──────────────────────
  // Some older 3CX builds use new Notification() directly from the page.

  const OrigNotification = window.Notification;
  if (OrigNotification) {
    window.Notification = function (title, options) {
      try {
        const data   = options?.data ?? {};
        const body   = options?.body ?? '';
        const number = extractCallerNumber(data)
                    || extractFromString(title)
                    || extractFromString(body);
        if (number) fire('__3cx_prm_call', { number, source: 'notification' });
      } catch (e) {}
      return new OrigNotification(title, options);
    };
    Object.assign(window.Notification, OrigNotification);
    window.Notification.prototype = OrigNotification.prototype;
  }

  // ── 4. WebSocket intercept (outbound + state tracking) ────────────────────
  // Outbound HAR showed 0 HTTP entries — calls go pure WS.
  // We only use WS to detect answered/ended transitions.

  const OrigWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);

    ws.addEventListener('message', function (evt) {
      try {
        if (typeof evt.data !== 'string') return;
        let p; try { p = JSON.parse(evt.data); } catch { return; }
        const s = evt.data.toLowerCase();

        // Outbound call ringing (dialling out)
        if (isOutboundRinging(p, s)) {
          const num = extractCallerNumber(p);
          if (num) fire('__3cx_prm_call_outbound', { number: num });
          return;
        }
        // Answered
        if (isAnswered(p, s)) { fire('__3cx_prm_call_answered', {}); return; }
        // Ended
        if (isEnded(p, s))    { fire('__3cx_prm_call_ended', {});    return; }

      } catch (e) {}
    });

    return ws;
  };
  Object.assign(window.WebSocket, OrigWS);
  window.WebSocket.prototype = OrigWS.prototype;

  // ── Payload parsers ────────────────────────────────────────────────────────

  function extractFromPushPayload(msg) {
    // msg.data can be the push payload directly or nested
    const candidates = [
      msg.data,
      msg.data?.notification,
      msg.data?.data,
      msg.notification,
      msg.payload,
    ].filter(Boolean);

    for (const c of candidates) {
      if (typeof c === 'string') {
        const n = extractFromString(c);
        if (n) return n;
      }
      if (typeof c === 'object') {
        const n = extractCallerNumber(c);
        if (n) return n;
        // Check title/body strings within
        for (const f of ['title','body','text','message','content']) {
          if (c[f]) {
            const n2 = extractFromString(String(c[f]));
            if (n2) return n2;
          }
        }
      }
    }
    return null;
  }

  function extractCallerNumber(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const numFields = [
      'callerNumber','caller_number','callerNum','cli','ani',
      'from','From','number','phoneNumber','phone',
      'CallerNumber','callerID','caller_id','displayNumber',
      'calling_party','sourceNumber','src'
    ];
    for (const f of numFields) {
      if (obj[f] && isPhone(obj[f])) return normalise(String(obj[f]));
    }
    // SIP URI
    for (const f of ['from_header','From','contact','sip_from']) {
      const v = obj[f];
      if (typeof v === 'string') {
        const m = v.match(/<sip:([+\d]+)@/) || v.match(/sip:([+\d]+)/);
        if (m && isPhone(m[1])) return normalise(m[1]);
      }
    }
    // Recurse one level
    for (const nested of ['data','params','payload','call','caller','info','body','notification']) {
      if (obj[nested] && typeof obj[nested]==='object') {
        const n = extractCallerNumber(obj[nested]);
        if (n) return n;
      }
    }
    return null;
  }

  // Extract a phone number from a plain string (notification title or body)
  // e.g. "Incoming call from +49 5601 961990" or "+49 5601 961990 - Jens Burgath"
  function extractFromString(str) {
    if (!str) return null;
    // Match: +49..., 0049..., standalone digit sequences >= 7 digits
    const m = str.match(/(\+\d[\d\s\-().]{5,18}\d)/)
           || str.match(/(00\d[\d\s\-().]{5,18}\d)/)
           || str.match(/\b(\d{3,5}[\s\-]?\d{3,5}[\s\-]?\d{3,6})\b/);
    if (m && isPhone(m[1])) return normalise(m[1]);
    return null;
  }

  // ── WS state detectors ────────────────────────────────────────────────────

  function isOutboundRinging(obj, str) {
    // Outbound: we are calling out, remote is ringing
    const states = ['ringing','alerting','180','calling','dialing','outbound'];
    return checkStateFields(obj, states) || states.some(w => str.includes(`"${w}"`));
  }

  function isAnswered(obj, str) {
    const states = ['accepted','answered','active','connected','established','200'];
    return checkStateFields(obj, states) || states.some(w => str.includes(`"${w}"`));
  }

  function isEnded(obj, str) {
    const states = ['bye','hangup','terminated','disconnected','call_ended','ended','rejected','busy','failed'];
    return checkStateFields(obj, states) || states.some(w => str.includes(`"${w}"`));
  }

  function checkStateFields(obj, words) {
    const fields = ['status','state','callState','call_state','type','event','action','eventType'];
    for (const f of fields) {
      const v = String(obj[f]??'').toLowerCase();
      if (words.some(w => v.includes(w))) return true;
    }
    // One level deep
    for (const nested of ['data','call','params','body']) {
      if (obj[nested] && typeof obj[nested]==='object') {
        for (const f of fields) {
          const v = String(obj[nested][f]??'').toLowerCase();
          if (words.some(w => v.includes(w))) return true;
        }
      }
    }
    return false;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function isPhone(v) {
    const s = String(v).replace(/[\s\-().]/g,'');
    return /^\+?[\d]{6,15}$/.test(s);
  }

  function normalise(v) {
    let s = String(v).replace(/[\s\-().]/g,'');
    if (s.startsWith('00')) s = '+' + s.slice(2);
    if (!s.startsWith('+') && s.length >= 8) s = '+' + s;
    return s;
  }

  function fire(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

})();
