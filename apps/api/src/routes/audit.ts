import * as A from '@automerge/automerge';
import { deleteEvent, updateEvent, type EditableEventFields, type TripDoc } from '@trip/crdt';
import { auditLog, users } from '@trip/schema';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { canEdit } from '../identity';

export function auditRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/:tripId', (c) => {
    const { db } = c.var.services;
    const membership = c.var.membership!;

    const source = c.req.query('source');

    const rows = db
      .select({
        id: auditLog.id,
        source: auditLog.source,
        clientId: auditLog.clientId,
        toolName: auditLog.toolName,
        summary: auditLog.summary,
        createdAt: auditLog.createdAt,
        undoneAt: auditLog.undoneAt,
        actor: users.displayName,
        canUndo: auditLog.beforeJson,
      })
      .from(auditLog)
      .innerJoin(users, eq(users.id, auditLog.actorUserId))
      .where(
        source
          ? and(eq(auditLog.tripId, membership.tripId), eq(auditLog.source, source as 'mcp'))
          : eq(auditLog.tripId, membership.tripId),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(100)
      .all();

    return c.json({
      entries: rows.map(({ canUndo, ...row }) => ({
        ...row,
        // A creation has nothing captured to put back; undoing it removes the
        // event instead, which the client still needs to be told is possible.
        undoable: row.undoneAt === null,
        restoresFields: canUndo !== null,
      })),
    });
  });

  /**
   * Puts back what an action replaced.
   *
   * Re-applied as a new change rather than reverted from history. That is the
   * only approach that stays correct once other people have edited the trip in
   * the meantime: it merges like any other edit, and a concurrent change to a
   * field this action never touched survives untouched.
   */
  app.post('/:tripId/:entryId/undo', (c) => {
    const { db, docs } = c.var.services;
    const membership = c.var.membership!;

    if (!canEdit(membership.role)) return c.json({ error: 'read_only' }, 403);

    const entry = db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.id, c.req.param('entryId')), eq(auditLog.tripId, membership.tripId)))
      .get();

    if (!entry) return c.json({ error: 'not_found' }, 404);
    if (entry.undoneAt !== null) return c.json({ error: 'already_undone' }, 409);

    const current = docs.load(membership.tripId);
    if (!current) return c.json({ error: 'no_such_trip' }, 404);

    const args = JSON.parse(entry.argsJson) as { eventId?: string };
    const before = entry.beforeJson
      ? (JSON.parse(entry.beforeJson) as Record<string, unknown>)
      : null;

    let next = current;

    if (entry.toolName === 'create_event') {
      // Nothing was replaced, so undoing a creation is removing what it made.
      const created = (current as TripDoc).events;
      const id = Object.keys(created).find((key) => created[key]?.name === argName(entry.argsJson));
      if (!id) return c.json({ error: 'nothing_to_undo' }, 409);

      next = deleteEvent(current, id, { userId: membership.userId });
    } else if (args.eventId && before) {
      next = updateEvent(current, args.eventId, before as Partial<EditableEventFields>, {
        userId: membership.userId,
      });
    } else {
      return c.json({ error: 'nothing_to_undo' }, 409);
    }

    docs.commit(membership.tripId, next, A.getChanges(current, next), membership.userId);
    db.update(auditLog).set({ undoneAt: Date.now() }).where(eq(auditLog.id, entry.id)).run();

    return c.json({ ok: true });
  });

  return app;
}

function argName(argsJson: string): string | undefined {
  return (JSON.parse(argsJson) as { name?: string }).name;
}
