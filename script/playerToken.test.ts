import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearPlayerToken, readPlayerToken, savePlayerToken } from '../src/client/playerToken.js';

test('player token persistence remains optional when browser storage is blocked', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: Access is denied'); },
    });
    assert.equal(readPlayerToken(), null);
    assert.equal(savePlayerToken('token'), false);
    assert.doesNotThrow(clearPlayerToken);

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem() { return 'saved-token'; },
        setItem() { throw new Error('QuotaExceededError'); },
        removeItem() { throw new Error('SecurityError'); },
      },
    });
    assert.equal(readPlayerToken(), 'saved-token');
    assert.equal(savePlayerToken('new-token'), false);
    assert.doesNotThrow(clearPlayerToken);

    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    });
    assert.equal(readPlayerToken(), null);
    assert.equal(savePlayerToken('new-token'), true);
    assert.equal(readPlayerToken(), 'new-token');
    clearPlayerToken();
    assert.equal(readPlayerToken(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});