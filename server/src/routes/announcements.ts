/**
 * Admin broadcast notifications.
 *  - Every app polls GET /v1/announcements when opened and from a background
 *    task, then shows new ones as a local notification (works without any
 *    push setup).
 *  - When the app build has an Expo project id, devices also register an Expo
 *    push token and get the message instantly through Expo's push service.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from './admin.js';

const Body = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().max(240).default(''),
  url: z.string().trim().max(300).regex(/^$|^\/[a-z0-9/_-]*$|^https:\/\/[^\s]+$/i).default(''),
});
const Register = z.object({
  token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,120}\]$/),
  platform: z.enum(['android', 'ios']).default('android'),
});
const Since = z.object({ after: z.string().datetime().optional() });
const IdParam = z.object({ id: z.string().uuid() });

const COLS = `id, title, body, url, pushed, created_at AS "createdAt"`;

/** Fan out to Expo push (best effort, 100 per request). Returns accepted count. */
async function pushToAll(a: { id: string; title: string; body: string; url: string }, log: FastifyInstance['log']) {
  const { rows } = await pool.query<{ token: string }>('SELECT token FROM push_tokens');
  let ok = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(
          chunk.map((r) => ({
            to: r.token,
            title: a.title,
            body: a.body,
            sound: 'default',
            priority: 'high',
            channelId: 'announcement',
            data: { announcementId: a.id, route: a.url.startsWith('/') ? a.url : '/inbox', url: a.url },
          })),
        ),
        signal: AbortSignal.timeout(15_000),
      });
      const out = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
      out?.data?.forEach((d, j) => {
        if (d.status === 'ok') ok++;
        else if (d.details?.error === 'DeviceNotRegistered') void pool.query('DELETE FROM push_tokens WHERE token = $1', [chunk[j].token]);
      });
    } catch (e) {
      log.warn({ err: e }, 'expo push failed');
    }
  }
  return ok;
}

export async function announcementRoutes(app: FastifyInstance) {
  app.get('/v1/announcements', async (req, reply) => {
    const { after } = Since.parse(req.query);
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM announcements WHERE ($1::timestamptz IS NULL OR created_at > $1) ORDER BY created_at DESC LIMIT 30`,
      [after ?? null],
    );
    return reply.header('cache-control', 'no-store').send({ announcements: rows });
  });

  app.post('/v1/push/register', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token, platform } = Register.parse(req.body);
    await pool.query(
      `INSERT INTO push_tokens (token, platform) VALUES ($1, $2)
       ON CONFLICT (token) DO UPDATE SET last_seen = now(), platform = excluded.platform`,
      [token, platform],
    );
    return reply.code(204).send();
  });

  const guard = { preHandler: requireAdmin };

  app.get('/v1/admin/announcements', guard, async () => {
    const [list, devices] = await Promise.all([
      pool.query(`SELECT ${COLS} FROM announcements ORDER BY created_at DESC LIMIT 50`),
      pool.query(`SELECT count(*)::int AS n FROM push_tokens`),
    ]);
    return { announcements: list.rows, pushDevices: devices.rows[0].n };
  });

  app.post('/v1/admin/announcements', guard, async (req, reply) => {
    const b = Body.parse(req.body);
    const { rows } = await pool.query(`INSERT INTO announcements (title, body, url) VALUES ($1, $2, $3) RETURNING ${COLS}`, [b.title, b.body, b.url]);
    const a = rows[0];
    req.log.info({ admin: req.userId, id: a.id }, 'admin: announcement sent');
    // push in the background; polling devices pick it up regardless
    void pushToAll(a, req.log).then((n) => pool.query('UPDATE announcements SET pushed = $2 WHERE id = $1', [a.id, n]));
    return reply.code(201).send(a);
  });

  app.delete('/v1/admin/announcements/:id', guard, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
    return reply.code(204).send();
  });
}
