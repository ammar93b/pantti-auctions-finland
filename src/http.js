// Web requests with a time limit and retries, and HTML text helpers.
// A failed request (time-out, network error, HTTP 5xx or 429) is tried again after
// config.retryDelaysMs (5 s, then 15 s). Other 4xx answers are not retried.

const CFG = require('../config');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const retryable = (err) => !(err instanceof HttpError) || err.status >= 500 || err.status === 429;

async function withRetries(fn) {
  const waits = CFG.retryDelaysMs || [];
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt >= waits.length || !retryable(err)) throw err;
      await sleep(waits[attempt]);
    }
  }
}

async function request(url, init, parse) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(CFG.requestTimeoutMs || 30000) });
  if (!res.ok) throw new HttpError(`${new URL(url).hostname} answered ${res.status}`, res.status);
  return parse(res);
}

function get(url, { json = false, headers = {} } = {}) {
  return withRetries(() => request(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fi-FI,fi;q=0.9,en;q=0.8', ...headers },
  }, (res) => (json ? res.json() : res.text())));
}

// A form POST that answers JSON (Pantti's bid feed)
function post(url, form, headers = {}) {
  return withRetries(() => request(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...headers },
    body: new URLSearchParams(form).toString(),
  }, (res) => res.json()));
}

// HTML entities → text (named, decimal, hex; out-of-range numbers are left as written)
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', ndash: '–', mdash: '—',
  Auml: 'Ä', auml: 'ä', Ouml: 'Ö', ouml: 'ö', Aring: 'Å', aring: 'å', eacute: 'é', Eacute: 'É' };
const decodeEntities = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  }
  return Object.hasOwn(NAMED, e) ? NAMED[e] : m;
}).replace(/[  ]/g, ' ');

// One line of text from HTML: tags removed, entities decoded, spaces collapsed
const text = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

module.exports = { get, post, sleep, text, decodeEntities, HttpError, UA };
