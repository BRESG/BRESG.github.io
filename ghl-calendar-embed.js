/*
 * ghl-calendar-embed
 *
 * Carries ad attribution and known contact details into a GoHighLevel
 * calendar iframe.
 *
 * Why this exists:
 *   1. The calendar lives in an iframe. The UTM values and click ids on the
 *      page URL never reach it, so bookings arrive with no source.
 *   2. The visitor often retypes a name, email and phone the page already
 *      knows, and some of them give up part way.
 *
 * What it does:
 *   Reads a fixed list of parameters from the page URL, remembers them for
 *   the session, and appends them to the src of every element marked with
 *   data-ghl-calendar.
 *
 * No build step, no dependencies. Drop it on the page with a script tag.
 */
(function () {
  'use strict';

  // The only parameters this script will ever forward. Anything else on the
  // page URL is ignored. Forwarding whatever happens to be in the query string
  // would hand a third party iframe data it was never meant to see.
  var ALLOWED = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'fbclid',
    'wbraid',
    'gbraid',
    'first_name',
    'last_name',
    'email',
    'phone'
  ];

  // One key holds everything, so the script leaves a single, obvious trace.
  var STORAGE_KEY = 'ghl_calendar_embed';

  // A cap on each value. Real UTM values and click ids are well under this.
  // Anything longer is a mistake or an attempt to stuff the URL.
  var MAX_VALUE_LENGTH = 200;

  // Mark a calendar iframe with this attribute and the script finds it.
  var SELECTOR = '[data-ghl-calendar]';

  // ---------------------------------------------------------------------
  // Environment helpers. Everything is read when it is needed, not at load
  // time, so the file can also be required in Node for the tests.
  // ---------------------------------------------------------------------

  function getWindow() {
    return typeof window !== 'undefined' ? window : null;
  }

  function getDocument() {
    var win = getWindow();
    if (win && win.document) return win.document;
    return typeof document !== 'undefined' ? document : null;
  }

  // sessionStorage throws in private mode and when cookies are blocked, and
  // reading the property itself can throw. Never let that break the page.
  function getStorage() {
    try {
      var win = getWindow();
      return win && win.sessionStorage ? win.sessionStorage : null;
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------

  function has(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  // True only for a key we allow that holds a non empty string.
  function hasValue(obj, key) {
    return has(obj, key) && typeof obj[key] === 'string' && obj[key] !== '';
  }

  // decodeURIComponent throws on a broken escape. Fall back to the raw text.
  function safeDecode(raw) {
    var text = String(raw).replace(/\+/g, ' ');
    try {
      return decodeURIComponent(text);
    } catch (err) {
      return text;
    }
  }

  // Trim and cut to the cap, so one value can never bloat the iframe src.
  function clean(value) {
    return String(value).trim().slice(0, MAX_VALUE_LENGTH);
  }

  // Turn "a=1&b=2" into { a: "1", b: "2" }. The first copy of a repeated key
  // wins, which is what a browser does with the query string it hands on.
  function parseQuery(search) {
    var out = {};
    if (!search) return out;
    var text = String(search);
    if (text.charAt(0) === '?') text = text.slice(1);
    if (!text) return out;
    var parts = text.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var eq = parts[i].indexOf('=');
      var key = safeDecode(eq === -1 ? parts[i] : parts[i].slice(0, eq));
      if (!key || has(out, key)) continue;
      out[key] = eq === -1 ? '' : safeDecode(parts[i].slice(eq + 1));
    }
    return out;
  }

  // Keep only allowed keys with a real value, trimmed and capped.
  function filterAllowed(source) {
    var out = {};
    for (var i = 0; i < ALLOWED.length; i++) {
      var key = ALLOWED[i];
      if (!has(source, key)) continue;
      var value = clean(source[key]);
      if (value !== '') out[key] = value;
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------

  function readStore() {
    var store = getStorage();
    if (!store) return {};
    try {
      var raw = store.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      // Filter again on the way out. Storage is visitor writable.
      return filterAllowed(parsed);
    } catch (err) {
      return {};
    }
  }

  function writeStore(values) {
    var store = getStorage();
    if (!store) return false;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(values));
      return true;
    } catch (err) {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Public behaviour
  // ---------------------------------------------------------------------

  // Read the page URL, merge it with what is already stored, and save it back.
  // First seen wins: a key that is already stored is never overwritten, so a
  // later visit with no query string cannot wipe the original ad source.
  function collect() {
    var win = getWindow();
    var search = win && win.location ? win.location.search : '';
    var fresh = filterAllowed(parseQuery(search));
    var stored = readStore();
    var merged = {};

    for (var i = 0; i < ALLOWED.length; i++) {
      var key = ALLOWED[i];
      if (hasValue(stored, key)) merged[key] = stored[key];
      else if (hasValue(fresh, key)) merged[key] = fresh[key];
    }

    writeStore(merged);
    return merged;
  }

  // Add the values to a src, keeping whatever was already on it and never
  // writing a key twice.
  function appendParams(src, values) {
    var rest = String(src);
    var hash = '';
    var hashAt = rest.indexOf('#');
    if (hashAt !== -1) {
      hash = rest.slice(hashAt);
      rest = rest.slice(0, hashAt);
    }

    var base = rest;
    var query = '';
    var queryAt = rest.indexOf('?');
    if (queryAt !== -1) {
      base = rest.slice(0, queryAt);
      query = rest.slice(queryAt + 1);
    }

    var existing = parseQuery(query);
    // Keep the original query text exactly as the author wrote it.
    var pairs = query ? [query] : [];

    for (var i = 0; i < ALLOWED.length; i++) {
      var key = ALLOWED[i];
      if (!hasValue(values, key)) continue;
      if (has(existing, key)) continue; // already on the src, leave it alone
      pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(values[key]));
    }

    var joined = pairs.join('&');
    return joined ? base + '?' + joined + hash : base + hash;
  }

  // Decorate one iframe. Returns the new src, or null if there was nothing
  // to work with.
  function decorate(iframe) {
    if (!iframe || typeof iframe.getAttribute !== 'function') return null;
    var src = iframe.getAttribute('src');
    if (typeof src !== 'string' || src === '') return null;
    var next = appendParams(src, collect());
    if (next !== src && typeof iframe.setAttribute === 'function') {
      iframe.setAttribute('src', next);
    }
    return next;
  }

  // Decorate every calendar on the page. If there is none, do nothing at all,
  // including no storage write.
  function init() {
    var doc = getDocument();
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];
    var nodes = doc.querySelectorAll(SELECTOR);
    if (!nodes || !nodes.length) return [];
    var results = [];
    for (var i = 0; i < nodes.length; i++) {
      results.push(decorate(nodes[i]));
    }
    return results;
  }

  // Forget everything for this session.
  function reset() {
    var store = getStorage();
    if (!store) return false;
    try {
      store.removeItem(STORAGE_KEY);
      return true;
    } catch (err) {
      return false;
    }
  }

  var api = {
    // A fresh copy every time, so nothing outside can edit the allowlist.
    get params() {
      return ALLOWED.slice();
    },
    storageKey: STORAGE_KEY,
    maxValueLength: MAX_VALUE_LENGTH,
    collect: collect,
    decorate: decorate,
    init: init,
    reset: reset
  };

  // Browser: hang the API off window and run once the page is ready.
  var browserWindow = getWindow();
  if (browserWindow) {
    browserWindow.GHLCalendarEmbed = api;
    var doc = browserWindow.document;
    if (doc && typeof doc.addEventListener === 'function') {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
      else init();
    }
  }

  // Node: export it so the tests can require it.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
