// Python-compatible JSON reading, envelope validation and text rendering (no Python counterpart: the Python server got
// these for free from pydantic and jiter).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyEnvelope, isJsonRpcNotification, isJsonRpcRequest } from './jsonrpc.ts';
import { PyFloat, PyInt, floatRepr, parseJson, pyDumps, pyRepr, toText } from './pyjson.ts';

describe('parseJson', () => {
  it('keeps Python number types and dict order', () => {
    const value = parseJson('{"3": 1, "1": [1.0, 2, 1e2, -0.0, 12345678901234567890], "a": "\\u00e9\\n"}') as any;
    assert.deepEqual(Object.keys(value).sort(), ['1', '3', 'a']);
    assert.equal(pyRepr(value), "{'3': 1, '1': [1.0, 2, 100.0, -0.0, 12345678901234567890], 'a': 'é\\n'}");
    assert.ok(value['1'][0] instanceof PyFloat);
    assert.ok(value['1'][4] instanceof PyInt);
    assert.equal(toText(value), '{\n  "3": 1,\n  "1": [\n    1.0,\n    2,\n    100.0,\n    -0.0,\n    12345678901234567890\n  ],\n  "a": "é\\n"\n}');
  });

  it('rejects what JSON.parse rejects', () => {
    for (const text of ['', '{', '[1,]', '01', '{"a":1}x', "{'a':1}", '"\t"', '{"a" 1}']) {
      assert.throws(() => parseJson(text), SyntaxError, text);
      assert.throws(() => JSON.parse(text), SyntaxError, text);
    }
    assert.deepEqual(parseJson(' {"__proto__": 1} '), JSON.parse('{"__proto__": 1}'));
  });

  it('accepts NaN and Infinity like jiter', () => {
    const value = parseJson('{"a": NaN, "b": [Infinity, -Infinity]}') as any;
    assert.ok(value.a instanceof PyFloat && Number.isNaN(value.a.value));
    assert.equal(pyRepr(value), "{'a': nan, 'b': [inf, -inf]}");
  });

  it('words errors like jiter (pydantic_core.from_json)', () => {
    const cases: Array<[string, string]> = [
      ['', 'EOF while parsing a value at line 1 column 0'],
      ['{"a":1,}', 'trailing comma at line 1 column 8'],
      ['[1 2]', 'expected `,` or `]` at line 1 column 4'],
      ['{"a" 1}', 'expected `:` at line 1 column 6'],
      ['{a:1}', 'key must be a string at line 1 column 2'],
      ['{"a":1}\n\n]', 'trailing characters at line 3 column 1'],
      ['{"a":tru}', 'expected ident at line 1 column 9'],
      ['"a\\x"', 'invalid escape at line 1 column 4'],
      ['-01', 'invalid number at line 1 column 3'],
      ['"a\nb"', 'control character (\\u0000-\\u001F) found while parsing a string at line 2 column 0'],
      ['"\\ud800"', 'unexpected end of hex escape at line 1 column 8'],
      ['"é', 'EOF while parsing a string at line 1 column 3'],
    ];
    for (const [text, message] of cases) assert.throws(() => parseJson(text), { name: 'JsonSyntaxError', message }, text);
  });
});

describe('JSON-RPC envelope', () => {
  it('classifies like the pydantic message union', () => {
    assert.equal(classifyEnvelope({ jsonrpc: '2.0', id: 1, method: 'ping' }), 'request');
    assert.equal(classifyEnvelope({ jsonrpc: '2.0', method: 'notifications/initialized' }), 'notification');
    assert.equal(classifyEnvelope({ jsonrpc: '2.0', id: 'x', result: {} }), 'response');
    assert.equal(classifyEnvelope({ jsonrpc: '2.0', id: null, error: { code: 1, message: 'm' } }), 'error');
    assert.ok(isJsonRpcRequest(parseJson('{"jsonrpc":"2.0","id":1,"method":"ping"}')));
    assert.ok(!isJsonRpcRequest(parseJson('{"jsonrpc":"2.0","id":1.0,"method":"ping"}')), 'RequestId ints are strict');
    assert.ok(!isJsonRpcRequest({ jsonrpc: '2.0', id: true, method: 'ping' }));
    assert.ok(isJsonRpcNotification({ jsonrpc: '2.0', method: 'x', params: null }));
    const error = classifyEnvelope({ jsonrpc: '1.0', id: 1, method: 'ping' });
    assert.equal(typeof error, 'object');
    assert.match(String(error), /validation errors? for union\[JSONRPCRequest,JSONRPCNotification,JSONRPCResponse,JSONRPCError\]\nJSONRPCRequest\.jsonrpc\n/);
  });
});

describe('Python formatting', () => {
  it('float repr', () => {
    const cases: Array<[number, string]> = [[0.1, '0.1'], [10, '10.0'], [1e16, '1e+16'], [1.5e-7, '1.5e-07'], [123456789.125, '123456789.125'],
      [1e22, '1e+22'], [0.0001, '0.0001'], [0.00001, '1e-05'], [-2.5, '-2.5'], [Infinity, 'inf']];
    for (const [x, text] of cases) assert.equal(floatRepr(x), text);
  });

  it('str repr and json.dumps', () => {
    assert.equal(pyRepr(["it's", 'a"b', "'\"", '\u0000\u00a0😀']), `["it's", 'a"b', '\\'"', '\\x00\\xa0😀']`);
    assert.equal(pyDumps({ a: [1, new PyFloat(2)], b: '한' }), '{"a": [1, 2.0], "b": "\\ud55c"}');
    assert.equal(pyDumps({ b: '한' }, { ensureAscii: false, compact: true }), '{"b":"한"}');
  });
});
