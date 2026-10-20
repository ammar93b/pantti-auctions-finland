// Web requests retry on time-outs and 5xx, not on other 4xx (spec 02).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const CFG = require('../config');

CFG.retryDelaysMs = [10, 10];
const { get } = require('../src/http');

function server(answers) {
  let i = 0;
  const srv = http.createServer((req, res) => { const code = answers[Math.min(i++, answers.length - 1)]; res.writeHead(code); res.end(code === 200 ? 'ok' : 'err'); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/`, count: () => i })));
}

test('two server errors, then success: the request succeeds', async () => {
  const s = await server([500, 503, 200]);
  assert.equal(await get(s.url), 'ok');
  assert.equal(s.count(), 3);
  s.srv.close();
});

test('three server errors: the request fails after three tries', async () => {
  const s = await server([500, 500, 500, 500]);
  await assert.rejects(get(s.url), /answered 500/);
  assert.equal(s.count(), 3);
  s.srv.close();
});

test('404 is not retried', async () => {
  const s = await server([404, 200]);
  await assert.rejects(get(s.url), /answered 404/);
  assert.equal(s.count(), 1);
  s.srv.close();
});
