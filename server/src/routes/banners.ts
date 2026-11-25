/**
 * Banners for the app's home carousel. Public read (no account needed, cached
 * by the app for offline use); create/update/delete only from the admin panel.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from './admin.js';

export const THEMES = ['coral', 'violet', 'mint', 'night', 'ocean', 'gold'] as const;

const text = (max: number) => z.string().trim().max(max).default('');
const BannerBody = z.object({
  tag: text(40),
  body: z.string().trim().min(1).max(280),
  arabic: text(160),
  source: text(80),
  theme: z.enum(THEMES).default('coral'),
  ctaLabel: text(30),
  // an in-app route ("/amal") or an https link
  ctaUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^$|^\/[a-z0-9/_-]*$|^https:\/\/[^\s]+$/i)
    .default(''),
  active: z.boolean().default(true),
  sort: z.number().int().min(-1000).max(1000).default(0),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});
const IdParam = z.object({ id: z.string().uuid() });

const COLS = `id, tag, body, arabic, source, theme, cta_label AS "ctaLabel", cta_url AS "ctaUrl",
  active, sort, starts_at AS "startsAt", ends_at AS "endsAt", updated_at AS "updatedAt"`;

export async function bannerRoutes(app: FastifyInstance) {
  app.get('/v1/banners', async (_req, reply) => {
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM banners
        WHERE active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
        ORDER BY sort, created_at DESC LIMIT 10`,
    );
    return reply.header('cache-control', 'public, max-age=300').send({ banners: rows });
  });

  const guard = { preHandler: requireAdmin };

  app.get('/v1/admin/banners', guard, async () => {
    const { rows } = await pool.query(`SELECT ${COLS} FROM banners ORDER BY sort, created_at DESC`);
    return { banners: rows };
  });

  app.post('/v1/admin/banners', guard, async (req, reply) => {
    const b = BannerBody.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO banners (tag, body, arabic, source, theme, cta_label, cta_url, active, sort, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${COLS}`,
      [b.tag, b.body, b.arabic, b.source, b.theme, b.ctaLabel, b.ctaUrl, b.active, b.sort, b.startsAt ?? null, b.endsAt ?? null],
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/v1/admin/banners/:id', guard, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const b = BannerBody.parse(req.body);
    const { rows } = await pool.query(
      `UPDATE banners SET tag=$2, body=$3, arabic=$4, source=$5, theme=$6, cta_label=$7, cta_url=$8,
              active=$9, sort=$10, starts_at=$11, ends_at=$12, updated_at=now()
        WHERE id=$1 RETURNING ${COLS}`,
      [id, b.tag, b.body, b.arabic, b.source, b.theme, b.ctaLabel, b.ctaUrl, b.active, b.sort, b.startsAt ?? null, b.endsAt ?? null],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    return rows[0];
  });

  app.delete('/v1/admin/banners/:id', guard, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    await pool.query('DELETE FROM banners WHERE id = $1', [id]);
    return reply.code(204).send();
  });
}
