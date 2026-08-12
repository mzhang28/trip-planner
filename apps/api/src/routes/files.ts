import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { fileLinkIsValid } from '../fileLinks';

const HASH = /^[a-f0-9]{64}$/;

/**
 * Attachments, fetched by something holding a signed link and nothing else.
 *
 * Deliberately outside `/api`, which mints or demands a person for every
 * request. What follows one of these is a model given a URL: it has no cookie,
 * no bearer token, and no way to acquire either, so the signature in the query
 * is the whole of its authority — and it is authority over one file.
 */
export function fileRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (!HASH.test(hash)) return c.json({ error: 'bad_hash' }, 400);

    const { db, blobs } = c.var.services;
    const expires = c.req.query('expires') ?? '';
    const sig = c.req.query('sig') ?? '';

    if (!fileLinkIsValid(db, hash, expires, sig)) {
      return c.json({ error: 'link_not_usable' }, 403);
    }

    if (!(await blobs.has(hash))) return c.json({ error: 'not_found' }, 404);

    // Object storage answers for itself, the same as the in-app route does.
    if (blobs.presignGet) return c.redirect(await blobs.presignGet(hash));

    const bytes = await blobs.get(hash);
    if (!bytes) return c.json({ error: 'not_found' }, 404);

    return new Response(bytes, {
      headers: {
        'content-type': c.req.query('mime') ?? 'application/octet-stream',
        /*
         * Not cached by anything in between. The bytes never change, but the
         * address does, and a shared cache holding one would go on answering
         * for a link that has run out.
         */
        'cache-control': 'private, no-store',
      },
    });
  });

  return app;
}
