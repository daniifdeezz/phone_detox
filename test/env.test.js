const test = require('node:test');
const assert = require('node:assert');
const { env } = require('../lib/env');

test('env limpia los errores típicos al pegar variables', () => {
  const cases = {
    'mailto:a@b.com': 'mailto:a@b.com',
    '=mailto:a@b.com': 'mailto:a@b.com',
    ' "mailto:a@b.com" ': 'mailto:a@b.com',
    'X_TEST=mailto:a@b.com': 'mailto:a@b.com',
    "='abc'": 'abc',
  };
  for (const [raw, want] of Object.entries(cases)) {
    process.env.X_TEST = raw;
    assert.strictEqual(env('X_TEST'), want, raw);
  }
  delete process.env.X_TEST;
  assert.strictEqual(env('X_TEST', 'def'), 'def');
});
