# Tadbeer Daily · তাদবীর ডেইলি

একজন মুসলিমের দৈনিক আমল, কাজ ও স্বাস্থ্যের সঙ্গী — Routine Planner, Task Manager, Universal Reminder, Water Tracker, Medicine Reminder, Zikr Counter ও নামাজ ট্র্যাকার এক অ্যাপে। **Offline-first**: সব ফিচার ইন্টারনেট ছাড়া চলে; অ্যাকাউন্ট খুললে ব্যাকআপ ও একাধিক ডিভাইসে sync হয়।

| Folder | What |
|---|---|
| [`mobile/`](mobile) | Android + iOS app (Expo / React Native, TypeScript) |
| [`server/`](server) | Auth + sync API (Node 22, Fastify, PostgreSQL) |
| [`deploy/`](deploy) | Docker Compose + Caddy (auto-HTTPS) + VPS scripts |
| [`web/`](web) | www.tadbeerdaily.com landing page + privacy policy |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How it all fits together |

## Features

- **নামাজ** — লোকেশন অনুযায়ী অফলাইনে নামাজের সময় (adhan), আযানের সময় রিমাইন্ডার/অ্যালার্ম, এক ট্যাপে চেক-ইন, হিজরি তারিখ
- **যিকির কাউন্টার** — দৈনিক লক্ষ্য (যেমন ২০০ বার), প্রতি N মিনিট/ঘণ্টায় রিমাইন্ডার, লক্ষ্য পূরণ হলে সেদিন আর বাজবে না
- **যেকোনো আমল** — কুরআন, দোয়া, সদকা, রোজা… প্রতিদিন / সপ্তাহের দিন / নির্দিষ্ট তারিখ / প্রতি N দিন / প্রতি মাসে
- **Task manager** — তারিখ, সময়, গুরুত্ব, রিমাইন্ডার বা অ্যালার্ম
- **Routine planner** — দিনের টাইমলাইন, নামাজের সময় সহ
- **Universal reminder** — যেকোনো কিছু, যেকোনো সময়সূচিতে
- **পানি ও ওষুধ** — দৈনিক লক্ষ্য, ডোজ, খাবারের আগে/পরে, স্টক, অ্যালার্ম
- **প্রাইভেট প্রোফাইল** — পয়েন্ট, লেভেল, ধারাবাহিকতা, ৭ দিনের চার্ট; শুধু ব্যবহারকারী নিজেই দেখতে পারেন
- নোটিফিকেশন + ভাইব্রেশন + অ্যালার্ম (Android exact alarm), বাংলা/English, লাইট/ডার্ক থিম, বায়োমেট্রিক অ্যাপ লক

## Run locally

```bash
cd mobile && npm install
npm start            # scan QR with a development build (see below)
npm test             # domain unit tests
npm run typecheck
```

```bash
cd server && npm install
cp .env.example .env # point DATABASE_URL at a local Postgres
npm run dev
DATABASE_URL=postgres://… npm test   # integration tests (needs Postgres)
```

Point the app at a local API with `EXPO_PUBLIC_API_URL=http://<your-ip>:8080 npm start`.

## Build the app (APK / Play Store)

Native modules (alarms, SQLite, biometrics) need a **development build**, not Expo Go.

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview      # installable .apk
npx eas-cli@latest build -p android --profile production   # .aab for Play Store
```

## Deploy to the VPS

See [`deploy/README.md`](deploy/README.md).
