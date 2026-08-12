import { describe, expect, it } from 'vitest';

/**
 * Loads the config module against a given environment.
 *
 * It reads `process.env` once at import, so each case needs its own module
 * instance rather than a second look at the one already evaluated.
 */
async function loadConfig(env: Record<string, string>) {
  const previous = { ...process.env };
  Object.assign(process.env, env);

  try {
    const { config } = await import(`./config?case=${encodeURIComponent(JSON.stringify(env))}`);
    return config as { PUBLIC_URL: string };
  } finally {
    process.env = previous;
  }
}

describe('the public URL', () => {
  it('drops a trailing slash', async () => {
    /*
     * Everything builds paths onto this. Left on, a client is sent to
     * `//connect`, and the string comparison that binds a token to this server
     * stops matching the address a client writes canonically.
     */
    const config = await loadConfig({ PUBLIC_URL: 'https://trips.example.io/' });
    expect(config.PUBLIC_URL).toBe('https://trips.example.io');
  });

  it('leaves one that was already clean alone', async () => {
    const config = await loadConfig({ PUBLIC_URL: 'https://trips.example.io' });
    expect(config.PUBLIC_URL).toBe('https://trips.example.io');
  });

  it('keeps a path base, minus its slash', async () => {
    const config = await loadConfig({ PUBLIC_URL: 'https://example.io/trips/' });
    expect(config.PUBLIC_URL).toBe('https://example.io/trips');
  });
});
