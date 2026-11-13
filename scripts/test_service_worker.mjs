import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const handlers = {};
const deleted = [];
const origin = 'https://example.test';
const scope = `${origin}/sdle-prep/`;
const cacheNames = ['another-app-cache', 'sdle-shell-v53', `sdle:${scope}:old`];
const context = {
  URL, Request, Response,
  self: { location: { origin }, registration: { scope }, addEventListener: (type, fn) => handlers[type] = fn, clients: { claim() {} }, skipWaiting() {} },
  caches: { keys: async () => cacheNames, delete: async key => deleted.push(key), open: async () => ({ match: async () => undefined, put: async () => {} }), match: async () => undefined },
  fetch: async () => { throw Error('offline'); }
};
vm.runInNewContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
let pending;
handlers.activate({ waitUntil: promise => pending = promise });
await pending;
assert.deepEqual(deleted, [`sdle:${scope}:old`], 'activation must not delete caches owned by other apps');
let response;
handlers.fetch({ request: new Request(`${origin}/other/app.js`), respondWith: p => response = p });
assert.equal(response, undefined, 'requests outside app scope must not be intercepted');
handlers.fetch({ request: new Request(`${scope}missing.js`), respondWith: p => response = p });
assert.equal((await response).status, 503, 'missing offline scripts must not receive HTML');
console.log('PASS: cache ownership, request scope, offline asset response');
