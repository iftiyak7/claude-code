import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { tx } from '../db.js';

export const COLLECTIONS = ['amals', 'tasks', 'reminders', 'medicines', 'routines', 'logs'] as const;
const MAX_RECORD_BYTES = 16 * 1024;
const PULL_LIMIT = 1000;

const Change = z.object({
  collection: z.enum(COLLECTIONS),
  id: z.string().min(1).max(120),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.boolean(),
  data: z.record(z.unknown()),
});

const SyncBody = z.object({
  cursor: z.string().regex(/^\d{1,18}$/),
  changes: z.array(Change).max(500),
});

export async function syncRoutes(app: FastifyInstance) {
  /**
   * One round-trip: push local changes, pull everything newer than `cursor`.
   * Conflicts resolve last-write-wins on the client `updatedAt`.
   */
  app.post('/v1/sync', { preHandler: requireUser, bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const body = SyncBody.parse(req.body);
    for (const ch of body.changes) {
      if (JSON.stringify(ch.data).length > MAX_RECORD_BYTES) return reply.code(413).send({ error: 'record_too_large' });
      if (ch.data.id !== undefined && ch.data.id !== ch.id) return reply.code(400).send({ error: 'validation_error' });
    }

    return tx(async (c) => {
      // Serialise syncs per user so `seq` is assigned in commit order and a
      // concurrent device can never skip over a change.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7))', [req.userId]);
      // records activity for the admin dashboard; also refuses suspended accounts
      const active = await c.query('UPDATE users SET last_sync_at = now() WHERE id = $1 AND disabled_at IS NULL RETURNING id', [req.userId]);
      if (active.rowCount === 0) return reply.code(403).send({ error: 'account_disabled' });

      if (body.changes.length > 0) {
        await c.query(
          `INSERT INTO records (user_id, collection, id, data, updated_at, deleted)
           SELECT $1, x.collection, x.id, x.data, x.updated_at, x.deleted
             FROM unnest($2::text[], $3::text[], $4::jsonb[], $5::bigint[], $6::boolean[])
                  AS x(collection, id, data, updated_at, deleted)
           ON CONFLICT (user_id, collection, id) DO UPDATE
              SET data = excluded.data,
                  updated_at = excluded.updated_at,
                  deleted = excluded.deleted,
                  seq = nextval('records_seq')
            WHERE records.updated_at < excluded.updated_at`,
          [
            req.userId,
            body.changes.map((x) => x.collection),
            body.changes.map((x) => x.id),
            body.changes.map((x) => JSON.stringify(x.data)),
            body.changes.map((x) => x.updatedAt),
            body.changes.map((x) => x.deleted),
          ],
        );
      }

      const { rows } = await c.query<{ collection: string; id: string; data: unknown; updated_at: number; deleted: boolean; seq: number }>(
        `SELECT collection, id, data, updated_at, deleted, seq
           FROM records WHERE user_id = $1 AND seq > $2
          ORDER BY seq LIMIT $3`,
        [req.userId, body.cursor, PULL_LIMIT + 1],
      );
      const hasMore = rows.length > PULL_LIMIT;
      const page = hasMore ? rows.slice(0, PULL_LIMIT) : rows;
      return {
        cursor: page.length ? String(page[page.length - 1].seq) : body.cursor,
        hasMore,
        changes: page.map((r) => ({ collection: r.collection, id: r.id, updatedAt: r.updated_at, deleted: r.deleted, data: r.data })),
      };
    });
  });
}
