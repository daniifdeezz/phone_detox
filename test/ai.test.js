const test = require('node:test');
const assert = require('node:assert');
const { extractJson } = require('../lib/ai');

test('extrae el JSON aunque venga con texto o bloques de código', () => {
  assert.deepStrictEqual(extractJson('{"paso": "Destápate"}'), { paso: 'Destápate' });
  assert.deepStrictEqual(extractJson('```json\n{"paso": "Destápate"}\n```'), { paso: 'Destápate' });
  assert.deepStrictEqual(extractJson('Claro: {"texto": "Bien"} ¡suerte!'), { texto: 'Bien' });
  assert.strictEqual(extractJson('sin json'), null);
  assert.strictEqual(extractJson('{roto'), null);
});
