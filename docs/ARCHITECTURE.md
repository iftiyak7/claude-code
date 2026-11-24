# Architecture

```
┌──────────────── Phone (Android / iOS) ────────────────┐
│  UI (expo-router screens, Reanimated animations)      │
│        │ reads (sync, in-memory)   │ writes            │
│        ▼                           ▼                   │
│  Zustand store  ──write-through──▶ SQLite (records,kv) │
│        │ rev++                      │ dirty rows       │
│        ├──▶ Notification planner ──▶ OS local alarms   │  ← works offline, app closed
│        └──▶ Sync engine ──HTTPS──┐                     │
└──────────────────────────────────┼─────────────────────┘
                                   ▼
           Caddy (TLS) ──▶ API (Fastify) ──▶ PostgreSQL
```

## Principles

1. **Offline-first.** The device is the primary copy. Every screen reads from memory, every write goes to SQLite first. No feature waits on the network.
2. **Server = backup + relay.** It stores opaque per-user JSON records; it never needs to understand app data, so new features rarely need server changes.
3. **Privacy by design.** No social features, no analytics, no leaderboard. Points are computed on-device from the user's own logs. Location never leaves the phone.

## Mobile (`mobile/src`)

| Path | Role |
|---|---|
| `domain/` | Pure TypeScript, no React — types, recurrence, prayer times (adhan, offline), points/streaks, notification planning. Unit-tested. |
| `db/storage.ts` | SQLite: one `records(collection,id,data,updated_at,dirty)` table + `kv`. Writes batched per tick in one transaction. `storage.web.ts` is the browser fallback. |
| `store/` | Zustand store hydrated synchronously at startup (no loading spinners). `upsert/remove/bump/setCount` write through to storage and mark rows dirty. |
| `notifications/scheduler.ts` | Rebuilds the plan (debounced) on every change and on app foreground, diffs against what the OS has scheduled, and only touches what changed. |
| `sync/` | API client with transparent token refresh; tokens in the OS keystore (expo-secure-store). |
| `security/LockGate.tsx` | Optional biometric lock, relocks after 30 s in background. |
| `ui/` | Design system: tokens (`theme.ts` — warm sand, coral accent, ink, lavender), bundled offline fonts (`fonts.ts` — Anek Bangla, Plus Jakarta Sans, Amiri), a font-aware `Text` that maps weights to real font files, and shared components. |
| `features/`, `app/` | Shared widgets and screens (expo-router). |

### Data model

All entities share `{ id, updatedAt, deleted? }`. Deletes are soft (tombstones) so they propagate through sync. Daily progress is a `Log` with a **deterministic id** `date|ref|refId|slot`, so the same day/item converges across devices instead of duplicating. Seeded amal (5 salah + zikr) also have fixed ids.

### Reminders that work offline

- Fixed daily items (plain-daily medicines, daily reminders, routine blocks) → **repeating OS triggers**: they keep firing forever even if the app is never opened again.
- Conditional items (zikr every hour *until the target is met*, water, salah at computed prayer times, weekly/monthly items) → **one-shot triggers for the next 3 days**, refreshed whenever the app opens or data changes.
- Total kept ≤ 60 (iOS allows 64 pending). Dailies are prioritised, then the soonest one-shots.
- Alarm items use a MAX-importance Android channel with alarm audio usage, long vibration, DND bypass, and `alarmClock` exact delivery (`SCHEDULE_EXACT_ALARM`).

## Sync protocol

`POST /v1/sync { cursor, changes[] } → { cursor, changes[], hasMore }` — one round-trip push + pull.

- Client pushes rows flagged dirty (≤ 500 per request), then pulls everything with server `seq > cursor`.
- Conflicts: **last-write-wins per record** on client `updatedAt` (enforced both in SQL `ON CONFLICT … WHERE` and in the client merge). Client timestamps are strictly increasing per record.
- The server assigns `seq` from a sequence inside a per-user advisory lock, so a device can never skip a concurrent change.
- A failed sync just leaves rows dirty; it is retried on the next trigger (8 s after edits, app foreground, login, manual).

## Server (`server/`)

Fastify 5 + `pg`. Endpoints: `register`, `login`, `refresh`, `logout`, `GET/DELETE /v1/me`, `POST /v1/sync`, `GET /health`. Migrations are plain SQL applied at boot under an advisory lock.

## Security

| Area | Measure |
|---|---|
| Passwords | argon2id (19 MiB, t=2), constant-time path for unknown emails (no account enumeration) |
| Sessions | 15-min HS256 access JWT (iss/aud/alg pinned) + opaque 60-day refresh token stored only as SHA-256; rotated on every use; replay of an old token revokes the whole family |
| Transport | HTTPS only (Caddy, HSTS preload), security headers, CORS allow-list |
| Abuse | Rate limits: 300/min global, 10/min on login/register, body size limits, zod validation on every input, per-record size cap |
| Isolation | Every query is scoped by the authenticated `user_id`; integration test proves user B can't read user A |
| Infra | DB on an internal-only Docker network, API container read-only + no capabilities, ufw (22/80/443), fail2ban, unattended upgrades, daily backups |
| Device | Tokens in Keychain/Keystore, optional biometric app lock, account deletion erases all server data |
| Logs | Authorization headers, passwords and refresh tokens are redacted |
