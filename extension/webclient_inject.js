// ============================================================
// webclient_inject.js — page context injector for team.3cx.com
//
// INBOUND CALLS — via Angular Service Worker push notifications
//   Angular NGSW broadcasts push payloads to open page clients.
//   We intercept navigator.serviceWorker messages and parse caller data.
//   Fallbacks: showNotification() and Notification constructor patches.
//
// OUTBOUND CALLS — via WebSocket
//   Patched WebSocket watches for outbound ringing, answered, and ended states.
// ============================================================

(function () {
  'use strict';

  const RECENT_EVENT_TTL = 2500;
  const recentEvents = new Map();
  let currentCallNumber = null;

  // ── 1. Angular NGSW Service Worker message interception ────────────────────
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function (evt) {
      try {
        const msg = evt.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'PUSH' || msg.type === 'NOTIFICATION_CLICK') {
          const number = extractFromPushPayload(msg);
          if (number) {
            currentCallNumber = number;
            fireOnce('__3cx_prm_call', { number, source: 'sw_push' });
            return;
          }
        }

        const raw = safeStringify(msg);
        const lower = raw.toLowerCase();

        if (/\b(ring|incoming|alerting|caller|call)\b/.test(lower)) {
          const number = extractCallerNumber(msg) || extractFromString(raw);
          if (number) {
            currentCallNumber = number;
            fireOnce('__3cx_prm_call', { number, source: 'sw_message' });
          }
        }
      } catch (_) {}
    });
  }

  // ── 2. ServiceWorkerRegistration.showNotification intercept ────────────────
  if (
    typeof ServiceWorkerRegistration !== 'undefined' &&
    ServiceWorkerRegistration.prototype &&
    ServiceWorkerRegistration.prototype.showNotification
  ) {
    const origShow = ServiceWorkerRegistration.prototype.showNotification;

    ServiceWorkerRegistration.prototype.showNotification = function (title, options = {}) {
      try {
        const data = options?.data ?? {};
        const body = options?.body ?? '';

        const number =
          extractCallerNumber(data) ||
          extractFromString(title) ||
          extractFromString(body);

        if (number) {
          currentCallNumber = number;
          fireOnce('__3cx_prm_call', {
            number,
            source: 'show_notification',
            title: String(title || ''),
            body: String(body || '')
          });
        }
      } catch (_) {}

      return origShow.apply(this, arguments);
    };
  }

  // ── 3. Notification constructor intercept ──────────────────────────────────
  const OrigNotification = window.Notification;

  if (OrigNotification) {
    function PatchedNotification(title, options = {}) {
      try {
        const data = options?.data ?? {};
        const body = options?.body ?? '';

        const number =
          extractCallerNumber(data) ||
          extractFromString(title) ||
          extractFromString(body);

        if (number) {
          currentCallNumber = number;
          fireOnce('__3cx_prm_call', {
            number,
            source: 'notification',
            title: String(title || ''),
            body: String(body || '')
          });
        }
      } catch (_) {}

      return new OrigNotification(title, options);
    }

    copyStaticProps(PatchedNotification, OrigNotification);
    PatchedNotification.prototype = OrigNotification.prototype;
    Object.setPrototypeOf(PatchedNotification, OrigNotification);
    window.Notification = PatchedNotification;
  }

  // ── 4. WebSocket intercept ─────────────────────────────────────────────────
  const OrigWS = window.WebSocket;

  if (OrigWS) {
    function PatchedWebSocket(...args) {
      const ws = new OrigWS(...args);

      ws.addEventListener('message', function (evt) {
        try {
          if (typeof evt.data !== 'string') return;

          const raw = evt.data;
          const lower = raw.toLowerCase();
          let payload = null;

          try {
            payload = JSON.parse(raw);
          } catch (_) {
            return;
          }

          const number = extractCallerNumber(payload) || extractFromString(raw) || currentCallNumber;

          if (isOutboundRinging(payload, lower)) {
            if (number) {
              currentCallNumber = number;
              fireOnce('__3cx_prm_call_outbound', {
                number,
                source: 'ws_outbound'
              });
            }
            return;
          }

          if (isAnswered(payload, lower)) {
            fireOnce('__3cx_prm_call_answered', {
              number: number || null,
              source: 'ws_answered'
            });
            return;
          }

          if (isEnded(payload, lower)) {
            fireOnce('__3cx_prm_call_ended', {
              number: number || null,
              source: 'ws_ended'
            });
          }
        } catch (_) {}
      });

      return ws;
    }

    copyStaticProps(PatchedWebSocket, OrigWS);
    PatchedWebSocket.prototype = OrigWS.prototype;
    Object.setPrototypeOf(PatchedWebSocket, OrigWS);
    window.WebSocket = PatchedWebSocket;
  }

  // ── Payload parsers ────────────────────────────────────────────────────────
  function extractFromPushPayload(msg) {
    const candidates = [
      msg?.data,
      msg?.data?.notification,
      msg?.data?.data,
      msg?.notification,
      msg?.payload
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const number = extractFromString(candidate);
        if (number) return number;
      }

      if (typeof candidate === 'object') {
        const number = extractCallerNumber(candidate);
        if (number) return number;

        for (const field of ['title', 'body', 'text', 'message', 'content']) {
          if (candidate[field]) {
            const fromText = extractFromString(String(candidate[field]));
            if (fromText) return fromText;
          }
        }
      }
    }

    return null;
  }

  function extractCallerNumber(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 3) return null;

    const numFields = [
      'callerNumber',
      'caller_number',
      'callerNum',
      'cli',
      'ani',
      'from',
      'From',
      'number',
      'phoneNumber',
      'phone',
      'CallerNumber',
      'callerID',
      'caller_id',
      'displayNumber',
      'calling_party',
      'sourceNumber',
      'src',
      'destination',
      'dst',
      'to',
      'To'
    ];

    for (const field of numFields) {
      const value = obj[field];

      if (typeof value === 'string' || typeof value === 'number') {
        const direct = String(value);
        if (isPhone(direct)) return normalise(direct);

        const extracted = extractFromString(direct);
        if (extracted) return extracted;
      }
    }

    const sipFields = ['from_header', 'From', 'contact', 'sip_from', 'to_header', 'To'];

    for (const field of sipFields) {
      const value = obj[field];

      if (typeof value === 'string') {
        const match =
          value.match(/<sip:([+\d][\d\s\-().]{5,20})@/i) ||
          value.match(/sip:([+\d][\d\s\-().]{5,20})/i);

        if (match && isPhone(match[1])) {
          return normalise(match[1]);
        }
      }
    }

    for (const nested of ['data', 'params', 'payload', 'call', 'caller', 'callee', 'info', 'body', 'notification']) {
      if (obj[nested] && typeof obj[nested] === 'object') {
        const number = extractCallerNumber(obj[nested], depth + 1);
        if (number) return number;
      }
    }

    return null;
  }

  function extractFromString(str) {
    if (!str) return null;

    const value = String(str);

    const match =
      value.match(/(\+\d[\d\s\-().]{5,20}\d)/) ||
      value.match(/(00\d[\d\s\-().]{5,20}\d)/) ||
      value.match(/\b(\d{3,5}[\s\-]?\d{3,5}[\s\-]?\d{3,8})\b/);

    if (match && isPhone(match[1])) {
      return normalise(match[1]);
    }

    return null;
  }

  // ── WS state detectors ────────────────────────────────────────────────────
  function isOutboundRinging(obj, raw) {
    const states = ['ringing', 'alerting', 'calling', 'dialing', 'dialling', 'outbound'];
    const hasState = checkStateFields(obj, states);

    const hasDirection =
      raw.includes('"outbound"') ||
      raw.includes('"direction":"out"') ||
      raw.includes('"isoutbound":true');

    return hasState && (hasDirection || !!extractCallerNumber(obj));
  }

  function isAnswered(obj, raw) {
    const states = ['accepted', 'answered', 'active', 'connected', 'established'];
    return checkStateFields(obj, states) && looksLikeCallEvent(raw);
  }

  function isEnded(obj, raw) {
    const states = [
      'bye',
      'hangup',
      'terminated',
      'disconnected',
      'call_ended',
      'ended',
      'rejected',
      'busy',
      'failed'
    ];

    return checkStateFields(obj, states) && looksLikeCallEvent(raw);
  }

  function checkStateFields(obj, words, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 2) return false;

    const fields = [
      'status',
      'state',
      'callState',
      'call_state',
      'type',
      'event',
      'action',
      'eventType',
      'name'
    ];

    for (const field of fields) {
      const value = String(obj[field] ?? '').toLowerCase();
      if (words.some(word => value.includes(word))) return true;
    }

    for (const nested of ['data', 'call', 'params', 'body', 'payload']) {
      if (obj[nested] && typeof obj[nested] === 'object') {
        if (checkStateFields(obj[nested], words, depth + 1)) return true;
      }
    }

    return false;
  }

  function looksLikeCallEvent(raw) {
    return /\b(call|voice|telephony|dialog|session|connection|party|phone)\b/i.test(raw);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function isPhone(value) {
    const compact = String(value).replace(/[\s\-().]/g, '');
    return /^\+?\d{6,15}$/.test(compact) || /^00\d{6,15}$/.test(compact);
  }

  function normalise(value) {
    let number = String(value).replace(/[\s\-().]/g, '');

    if (number.startsWith('00')) {
      number = `+${number.slice(2)}`;
    }

    if (!number.startsWith('+') && number.length >= 10) {
      number = `+${number}`;
    }

    return number;
  }

  function fire(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function fireOnce(name, detail) {
    const number = detail?.number || '';
    const key = `${name}:${number}`;
    const now = Date.now();

    for (const [eventKey, timestamp] of recentEvents.entries()) {
      if (now - timestamp > RECENT_EVENT_TTL) recentEvents.delete(eventKey);
    }

    if (recentEvents.has(key)) return;

    recentEvents.set(key, now);
    fire(name, detail);
  }

  function safeStringify(value) {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return '';
    }
  }

  function copyStaticProps(target, source) {
    for (const key of Object.getOwnPropertyNames(source)) {
      if (['length', 'name', 'prototype'].includes(key)) continue;

      try {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      } catch (_) {}
    }
  }
})();
