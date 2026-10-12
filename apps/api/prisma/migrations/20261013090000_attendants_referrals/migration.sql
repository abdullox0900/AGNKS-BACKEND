-- "Who brought you?": fuel-station attendants and clients' answers. New tables only; nothing existing is touched.
CREATE TABLE "attendants" (
    "id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_referrals" (
    "user_id" TEXT NOT NULL,
    "attendant_id" TEXT,
    "typed_name" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_referrals_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "attendants_station_id_name_key" ON "attendants"("station_id", "name");
CREATE INDEX "client_referrals_attendant_id_idx" ON "client_referrals"("attendant_id");
CREATE INDEX "client_referrals_created_at_idx" ON "client_referrals"("created_at");

ALTER TABLE "attendants" ADD CONSTRAINT "attendants_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_referrals" ADD CONSTRAINT "client_referrals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_referrals" ADD CONSTRAINT "client_referrals_attendant_id_fkey" FOREIGN KEY ("attendant_id") REFERENCES "attendants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
