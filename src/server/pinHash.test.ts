import { describe, expect, it } from 'vitest';
import { hashPin, isValidPin, verifyPin } from './pinHash.js';

describe('hashPin and verifyPin', () => {
  it('verifies the PIN it was made from and no other', () => {
    const stored = hashPin('1234');

    expect(verifyPin('1234', stored)).toBe(true);
    expect(verifyPin('1235', stored)).toBe(false);
    expect(verifyPin('0000', stored)).toBe(false);
  });

  it('salts: the same PIN hashes differently each time', () => {
    expect(hashPin('1234')).not.toBe(hashPin('1234'));
  });

  it('stores the algorithm and its parameters with the hash', () => {
    expect(hashPin('1234')).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  });

  it.each(['', 'plain', 'scrypt$x$8$1$abc$def', 'scrypt$16384$8$1$abc', 'md5$a$b$c$d$e'])(
    'never matches an unreadable stored value (%j)',
    (stored) => {
      expect(verifyPin('1234', stored)).toBe(false);
    },
  );
});

describe('isValidPin', () => {
  it.each(['0000', '1234', '9999'])('accepts %j', (pin) => {
    expect(isValidPin(pin)).toBe(true);
  });

  it.each(['123', '12345', '12a4', ' 1234', '１２３４', 1234, null, undefined])(
    'rejects %j',
    (pin) => {
      expect(isValidPin(pin)).toBe(false);
    },
  );
});
