import { describe, expect, it, vi } from 'vitest';
import { randomId, sha256Hex } from './crypto';

/** Published SHA-256 vectors, so the fallback is checked against the real answer. */
const VECTORS: Array<[string, string]> = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
];

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('sha256Hex', () => {
  it('matches the published vectors', async () => {
    for (const [input, expected] of VECTORS) {
      expect(await sha256Hex(encode(input)), input).toBe(expected);
    }
  });

  it('gives the same answer with and without WebCrypto', async () => {
    const input = encode('Confirmation 7K2QLM');
    const withSubtle = await sha256Hex(input);

    // A dev server reached by hostname over plain HTTP has no crypto.subtle,
    // and a file hashed there has to land under the same name as one hashed in
    // a browser that does -- otherwise the same file is two blobs.
    const subtle = crypto.subtle;
    vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({
      ...crypto,
      subtle: undefined,
    } as unknown as Crypto);

    const withoutSubtle = await sha256Hex(input);
    vi.restoreAllMocks();

    expect(withoutSubtle).toBe(withSubtle);
    expect(subtle).toBeDefined();
  });
});

describe('randomId', () => {
  it('gives a different value every time', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size).toBe(500);
  });

  it('still works with no randomUUID, which needs a secure context', () => {
    vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue({
      getRandomValues: crypto.getRandomValues.bind(crypto),
    } as unknown as Crypto);

    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    vi.restoreAllMocks();

    expect(ids.size).toBe(200);
    expect([...ids][0]).toMatch(/^[0-9a-f]{32}$/);
  });
});
