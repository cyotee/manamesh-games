import { describe, expect, it } from 'vitest';
import { stableStringify } from './stable-json.js';

describe('signing JSON field preservation', () => {
  it('does not collide with a message whose __proto__ field was removed', () => {
    for (const value of [null, {}, { role: 'host' }, 'seat']) {
      const input = JSON.parse(`{"__proto__":${JSON.stringify(value)},"sequence":1}`);
      const encoded = stableStringify(input);
      expect(encoded).not.toBe(stableStringify({ sequence: 1 }));
      expect(JSON.parse(encoded)).toEqual(input);
    }
  });
  it('preserves nested reserved keys and stable ordering', () => {
    const input = JSON.parse('{"z":[{"constructor":1,"__proto__":{"b":2,"a":1}}],"a":0}');
    expect(stableStringify(input)).toBe('{"a":0,"z":[{"__proto__":{"a":1,"b":2},"constructor":1}]}');
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('b');
  });
});
