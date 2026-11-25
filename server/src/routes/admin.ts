/**
 * Admin API + the admin panel's static files (served at /admin).
 *
 * Privacy by design: admins see account metadata and aggregate counts only.
 * No endpoint here ever returns the content of a user's records.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { config } from '../config.js';
import { pool } from '../db.js';

// src/routes (dev) or dist/routes (prod) → <server>/admin
const ADMIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin');
const STATIC: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // inline style attributes are used for chart bar heights; scripts stay locked to 'self'
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** preHandler: valid access token AND an email on the ADMIN_EMAILS list. */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent) return;
  const { rows } = await pool.query<{ email: string; disabled: boolean }>(
    'SELECT email, disabled_at IS NOT NULL AS disabled FROM users WHERE id = $1',
    [req.userId],
  );
  const u = rows[0];
  if (!u || u.disabled || !config.adminEmails.has(u.email.toLowerCase())) {
    return reply.code(403).send({ error: 'not_admin' });
  }
}

const ListQuery = z.object({
  q: z.string().trim().max(120).optional().default(''),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const IdParam = z.object({ id: z.string().uuid() });

export async function adminRoutes(app: FastifyInstance) {
  // ── static panel ────────────────────────────────────────────────────────
  const serve = (file: string) => async (_req: FastifyRequest, reply: FastifyReply) => {
    const body = await readFile(join(ADMIN_DIR, file));
    return reply
      .header('content-type', STATIC[file])
      .header('content-security-policy', CSP)
      .header('cache-control', file === 'index.html' ? 'no-store' : 'public, max-age=300')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(body);
  };
  app.get('/admin', serve('index.html'));
  app.get('/admin/', serve('index.html'));
  app.get('/admin/app.js', serve('app.js'));
  app.get('/admin/style.css', serve('style.css'));

  // ── API ─────────────────────────────────────────────────────────────────
  const guard = { preHandler: requireAdmin };

  app.get('/v1/admin/me', guard, async () => ({ ok: true }));

  app.get('/v1/admin/stats', guard, async () => {
    const [users, collections, signups, db] = await Promise.all([
      pool.query(`
        SELECT count(*)::int                                                         AS total,
               count(*) FILTER (WHERE created_at > now() - interval '1 day')::int    AS new_1d,
               count(*) FILTER (WHERE created_at > now() - interval '7 days')::int   AS new_7d,
               count(*) FILTER (WHERE created_at > now() - interval '30 days')::int  AS new_30d,
               count(*) FILTER (WHERE greatest(last_sync_at, last_login_at) > now() - interval '1 day')::int  AS active_1d,
               count(*) FILTER (WHERE greatest(last_sync_at, last_login_at) > now() - interval '7 days')::int AS active_7d,
               count(*) FILTER (WHERE disabled_at IS NOT NULL)::int                  AS disabled
          FROM users`),
      pool.query(`SELECT collection, count(*)::int AS n FROM records WHERE NOT deleted GROUP BY collection ORDER BY collection`),
      pool.query(`
        SELECT to_char(d, 'YYYY-MM-DD') AS day, count(u.id)::int AS n
          FROM generate_series(current_date - 29, current_date, interval '1 day') d
          LEFT JOIN users u ON u.created_at >= d AND u.created_at < d + interval '1 day'
         GROUP BY d ORDER BY d`),
      pool.query(`SELECT pg_database_size(current_database())::bigint AS bytes`),
    ]);
    return {
      users: users.rows[0],
      records: Object.fromEntries(collections.rows.map((r) => [r.collection, r.n])),
      signups: signups.rows,
      server: {
        dbBytes: Number(db.rows[0].bytes),
        uptimeSec: Math.round(process.uptime()),
        node: process.version,
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
    };
  });

  app.get('/v1/admin/users', guard, async (req) => {
    const { q, page } = ListQuery.parse(req.query);
    const size = 25;
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.created_at, u.last_login_at, u.last_sync_at,
              u.disabled_at IS NOT NULL AS disabled,
              (SELECT count(*)::int FROM records r WHERE r.user_id = u.id AND NOT r.deleted) AS records,
              count(*) OVER ()::int AS total
         FROM users u
        WHERE $1 = '' OR u.email ILIKE $2 OR u.name ILIKE $2
        ORDER BY u.created_at DESC
        LIMIT $3 OFFSET $4`,
      [q, like, size, (page - 1) * size],
    );
    return {
      page,
      pageSize: size,
      total: rows[0]?.total ?? 0,
      users: rows.map(({ total: _t, ...u }) => ({ ...u, admin: config.adminEmails.has(String(u.email).toLowerCase()) })),
    };
  });

  const notSelf = (req: FastifyRequest, id: string, reply: FastifyReply) => {
    if (id === req.userId) {
      void reply.code(400).send({ error: 'cannot_modify_self' });
      return false;
    }
    return true;
  };

  app.post('/v1/admin/users/:id/disable', guard, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    if (!notSelf(req, id, reply)) return;
    await pool.query('UPDATE users SET disabled_at = coalesce(disabled_at, now()) WHERE id = $1', [id]);
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    req.log.info({ admin: req.userId, target: id }, 'admin: user disabled');
    return reply.code(204).send();
  });

  app.post('/v1/admin/users/:id/enable', guard, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    await pool.query('UPDATE users SET disabled_at = NULL WHERE id = $1', [id]);
    req.log.info({ admin: req.userId, target: id }, 'admin: user enabled');
    return reply.code(204).send();
  });

  app.post('/v1/admin/users/:id/logout', guard, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    req.log.info({ admin: req.userId, target: id }, 'admin: sessions revoked');
    return reply.code(204).send();
  });

  app.delete('/v1/admin/users/:id', guard, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    if (!notSelf(req, id, reply)) return;
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    req.log.info({ admin: req.userId, target: id }, 'admin: user deleted');
    return reply.code(204).send();
  });
}
