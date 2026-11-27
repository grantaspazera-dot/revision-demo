/* First-party visit tracking for demo.revision.lt. Never throws, never logs. */
(function () {
  'use strict';
  try {
    var ENDPOINT = 'https://os.revision.lt/api/public/track';
    var SITE = 'demo.revision.lt';
    var UTM_KEYS = ['utm_source', 'utm_campaign', 'utm_content'];
    var SS_SESSION = 'rev_session_id';

    function noop() {}

    function guard(fn) {
      try { return fn(); } catch (e) { return undefined; }
    }

    function now() {
      var t = guard(function () {
        if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
          return performance.now();
        }
        return Date.now();
      });
      return typeof t === 'number' ? t : Date.now();
    }

    function ssGet(key) {
      var value = guard(function () { return sessionStorage.getItem(key); });
      return typeof value === 'string' ? value : '';
    }

    function ssSet(key, value) {
      guard(function () { sessionStorage.setItem(key, value); });
    }

    function newSessionId() {
      var id = guard(function () {
        var cryptoObj = window.crypto;
        if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
        return '';
      });
      if (id) return id;
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    }

    var utm = {
      utm_source: ssGet('rev_utm_source'),
      utm_campaign: ssGet('rev_utm_campaign'),
      utm_content: ssGet('rev_utm_content')
    };
    guard(function () {
      var params = new URLSearchParams(window.location.search);
      for (var i = 0; i < UTM_KEYS.length; i++) {
        var key = UTM_KEYS[i];
        var value = params.get(key);
        if (value) {
          utm[key] = value;
          ssSet('rev_' + key, value);
        }
      }
    });

    var sessionId = ssGet(SS_SESSION);
    if (!sessionId) {
      sessionId = newSessionId();
      ssSet(SS_SESSION, sessionId);
    }

    function pagePath() {
      var path = guard(function () { return window.location.pathname; });
      if (typeof path !== 'string' || !path) return '/';
      return path.charAt(0) === '/' ? path : '/' + path;
    }

    function payload(eventType, extra) {
      var data = {
        session_id: sessionId || '',
        site: SITE,
        event_type: eventType,
        page_path: pagePath(),
        page_title: guard(function () { return document.title; }) || '',
        utm_source: utm.utm_source,
        utm_campaign: utm.utm_campaign,
        utm_content: utm.utm_content,
        referrer: guard(function () { return document.referrer; }) || '',
        click_href: '',
        click_text: '',
        duration_sec: 0
      };
      if (extra) {
        if (typeof extra.click_href === 'string') data.click_href = extra.click_href;
        if (typeof extra.click_text === 'string') data.click_text = extra.click_text;
        if (typeof extra.duration_sec === 'number' && isFinite(extra.duration_sec)) {
          data.duration_sec = extra.duration_sec;
        }
      }
      return data;
    }

    function send(eventType, extra) {
      guard(function () {
        var json = JSON.stringify(payload(eventType, extra));
        var queued = false;
        try {
          if (typeof navigator.sendBeacon === 'function') {
            queued = navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'text/plain' })) === true;
          }
        } catch (e) {
          queued = false;
        }
        if (!queued && typeof fetch === 'function') {
          try {
            fetch(ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: json,
              keepalive: true
            }).catch(noop);
          } catch (e) {}
        }
      });
    }

    function interactive(node) {
      while (node && node !== document) {
        if (node.nodeType === 1) {
          var tag = node.tagName;
          if (tag === 'A' || tag === 'BUTTON') return node;
        }
        node = node.parentElement || node.parentNode;
      }
      return null;
    }

    function clickHref(el) {
      if (el.tagName === 'A') return el.getAttribute('href') || '';
      var go = el.getAttribute('data-go');
      if (go != null && go !== '') return '#' + go;
      return '';
    }

    function clickText(el) {
      var raw = guard(function () { return el.innerText; });
      if (typeof raw !== 'string' || !raw) raw = guard(function () { return el.textContent; }) || '';
      var text = String(raw).replace(/\s+/g, ' ').trim();
      if (!text) text = String(el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (text.length > 120) text = text.slice(0, 120);
      return text;
    }

    document.addEventListener('click', function (e) {
      guard(function () {
        var el = interactive(e.target);
        if (!el) return;
        send('click', { click_href: clickHref(el), click_text: clickText(el) });
      });
    }, true);

    /* Active visible time. Each leave reports seconds since the previous leave.
       visibilitychange(hidden) then pagehide would otherwise emit a second 0s event. */
    var activeMs = 0;
    var runningSince = null;
    var sentLeave = false;

    function hidden() {
      return guard(function () { return document.visibilityState === 'hidden'; }) === true;
    }

    function freeze() {
      if (runningSince != null) {
        activeMs += now() - runningSince;
        runningSince = null;
      }
    }

    function resume() {
      if (!hidden() && runningSince == null) runningSince = now();
    }

    function sendLeave() {
      freeze();
      var sec = Math.round(activeMs / 1000);
      if (!isFinite(sec) || sec < 0) sec = 0;
      if (sec === 0 && sentLeave) return;
      send('leave', { duration_sec: sec });
      sentLeave = true;
      activeMs -= sec * 1000;
      if (activeMs < 0) activeMs = 0;
    }

    document.addEventListener('visibilitychange', function () {
      guard(function () {
        if (hidden()) sendLeave();
        else resume();
      });
    });

    window.addEventListener('pagehide', function () {
      guard(sendLeave);
    });

    resume();
    send('pageview');
  } catch (e) {}
})();
