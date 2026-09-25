# AGNKS Backend

TZ-4 asosidagi backend: NestJS 10 + PostgreSQL 16 + Prisma + Redis + BullMQ. `apps/api` — API server va fon worker (`main.ts` / `worker.ts`), `packages/types` — Zod sxemalar va xato kodlari (frontendlar bilan yagona manba).

## Nega ikkita process (API + worker)?

`apps/api/src/main.ts` (HTTP so'rovlar) va `apps/api/src/worker.ts` (BullMQ fon vazifalari — outbox, sverka, anomaliya va h.k.) **alohida OS processlar**. Agar bitta jarayonda birlashtirilsa, og'ir yoki qotib qolgan fon vazifasi butun API'ni ham urib qo'yishi mumkin edi. Shu sababli ular alohida — biri qulasa, ikkinchisi ishlayveradi (pm2 orqali avtomatik qayta ishga tushadi).

## Ishga tushirish (development)

```bash
# 1. Bog'liqliklarni o'rnatish
pnpm install

# 2. PostgreSQL va Redis (docker bilan, yoki brew orqali mahalliy)
pnpm docker:up
# yoki: brew services start postgresql@16 && brew services start redis

# 3. .env yaratish
cp apps/api/.env.example apps/api/.env
# DATABASE_URL, REDIS_URL, TELEGRAM_*_BOT_TOKEN, JWT_*_SECRET larni to'ldiring

# 4. Sxema va migratsiyalar
cd apps/api
pnpm prisma:migrate      # birinchi marta: --name init
pnpm prisma:seed         # test uchun: 1 filial, 1 root_admin (parol+TOTP), 1 kassir (PIN)

# 5. Ishga tushirish (ikkita alohida terminalda)
pnpm dev                 # API — apps/api dan: nest start --watch
pnpm dev:worker          # Worker — apps/api dan: nest start worker --watch
```

Seed skripti terminalga root_admin paroli, TOTP siri va kassir PIN kodini chiqaradi — dashboard va kassir login oqimlarini sinash uchun.

## Production (pm2)

```bash
pnpm build                          # ikkalasini ham build qiladi (dist/main.js, dist/worker.js)
pm2 start ecosystem.config.cjs --env production
```

`ecosystem.config.cjs` ikkita alohida pm2 process (`agnks-api`, `agnks-worker`) beradi — har biri mustaqil qayta ishga tushadi.

## Struktura

```
apps/api/src/
├── modules/       # auth, users, stations, receipts, spend, ledger, shifts,
│                  # disputes, rules, analytics, notifications, files, audit, bot
├── common/        # guards, interceptors, filters, decorators, pipes, lib
├── infra/         # prisma, redis, telegram, storage, queue — barchasi @Global
└── jobs/          # BullMQ processorlar + scheduler (faqat worker.ts import qiladi)
```

**Qatlam qoidasi:** controller (faqat HTTP) → service (biznes mantiq) → Prisma. Pul bilan bog'liq HAR QANDAY o'zgarish faqat `LedgerService.post()` orqali (`SELECT ... FOR UPDATE` bilan qulflangan, manfiy balansga yo'l qo'ymaydi).

## Muhim qarorlar

- **Bitta xato hammasini to'xtatmaydi**: `GlobalExceptionFilter` har qanday xatoni struktura javobiga aylantiradi; `uncaughtException`/`unhandledRejection` ushlanadi va log qilinadi (process o'lmaydi); Telegram bot handlerlari `bot.catch()` bilan o'ralgan.
- **Idempotentlik**: barcha yozuvchi so'rovlar `Idempotency-Key` sarlavhasini talab qiladi (Redis + `idempotency_keys` jadvali zaxira sifatida).
- **Soliq.uz integratsiyasi**: chek yuborilganda backend `ofd.soliq.uz` sahifasini o'qishga harakat qiladi (summани tekshirish uchun) — bu **faqat maslahat xarakterida**: soliq.uz ishlamasa yoki formatini o'zgartirsa, mijoz baribir qo'lda kiritgan summasi bilan davom etadi, faqat mos kelmasa tekshiruvga (`pending_review`) tushadi.
- **Rollar**: `client`, `cashier`, `branch_manager`, `root_admin`, `seo` (eng yuqori, tarmoq darajasida). Ruxsatlar faqat backendda tekshiriladi.

## Test

```bash
cd apps/api && pnpm test
```

Hozircha eng muhim sof mantiq qismlari qamrab olingan: QR parser, pul/bonus hisoblash, masofa hisoblash, foiz aniqlash (rate resolver). Integratsiya va poyga-holat (race condition) testlari TZ-4 §12 bo'yicha keyingi bosqichda qo'shiladi.
