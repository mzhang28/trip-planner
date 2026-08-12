import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { canEdit } from '../identity';

/** Big enough for a scan of a booking, small enough not to be a problem. */
const MAX_BYTES = 25 * 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/;

export function blobRoutes() {
  const app = new Hono<AppEnv>();

  /**
   * Whether these bytes are already here, without sending them back.
   *
   * Content addressing makes this worth asking: the same confirmation attached
   * by two people uploads once, and a retried upload costs nothing.
   */
  app.on('HEAD', '/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (!HASH.test(hash)) return c.body(null, 400);

    return c.body(null, (await c.var.services.blobs.has(hash)) ? 200 : 404);
  });

  app.get('/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (!HASH.test(hash)) return c.json({ error: 'bad_hash' }, 400);

    const { blobs } = c.var.services;
    if (!(await blobs.has(hash))) return c.json({ error: 'not_found' }, 404);

    if (blobs.presignGet) {
      // File links point at this route for both storage modes. Redirecting
      // keeps that contract identical when S3 is configured; returning the URL
      // as JSON would make the browser download a JSON document instead.
      return c.redirect(await blobs.presignGet(hash));
    }

    const bytes = await blobs.get(hash);
    if (!bytes) return c.json({ error: 'not_found' }, 404);

    return new Response(bytes, {
      headers: {
        'content-type': c.req.query('mime') ?? 'application/octet-stream',
        // The name is the content, so it can never go stale.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  /**
   * Where to send these bytes.
   *
   * On object storage this hands back a URL the browser uploads to directly, so
   * a twenty-megabyte scan never travels through this server and never holds a
   * request open for the minute it takes to arrive. On the filesystem store
   * there is nowhere else to send it, so the answer is to come back here.
   */
  app.post('/:hash/upload-url', async (c) => {
    const hash = c.req.param('hash');
    if (!HASH.test(hash)) return c.json({ error: 'bad_hash' }, 400);

    const membership = c.var.membership;
    if (membership && !canEdit(membership.role)) return c.json({ error: 'read_only' }, 403);

    const { blobs } = c.var.services;
    if (await blobs.has(hash)) return c.json({ alreadyStored: true });

    const mime = c.req.query('mime') ?? 'application/octet-stream';

    if (blobs.presignPut) {
      return c.json({ method: 'PUT', url: await blobs.presignPut(hash, mime), direct: true });
    }

    return c.json({ method: 'PUT', url: `/api/blobs/${hash}`, direct: false });
  });

  app.put('/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (!HASH.test(hash)) return c.json({ error: 'bad_hash' }, 400);

    const membership = c.var.membership;
    if (membership && !canEdit(membership.role)) return c.json({ error: 'read_only' }, 403);

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength === 0) return c.json({ error: 'empty' }, 400);
    if (body.byteLength > MAX_BYTES) return c.json({ error: 'too_large' }, 413);

    /*
     * The bytes are hashed here rather than trusted from the URL. Otherwise
     * anyone could store whatever they liked under the hash of something else,
     * and every later reader would get bytes that are not what they asked for.
     */
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== hash) return c.json({ error: 'hash_mismatch', actual }, 400);

    const { blobs } = c.var.services;
    await blobs.put(hash, body, c.req.header('content-type') ?? 'application/octet-stream');

    return c.json({ hash, size: body.byteLength }, 201);
  });

  return app;
}
