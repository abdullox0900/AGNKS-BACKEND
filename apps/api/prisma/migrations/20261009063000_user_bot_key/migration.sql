-- Which client bot (main / a station key) a person last opened the app from.
-- Nullable and additive: existing rows stay NULL and keep being served by the main bot.
ALTER TABLE "users" ADD COLUMN "bot_key" TEXT;
