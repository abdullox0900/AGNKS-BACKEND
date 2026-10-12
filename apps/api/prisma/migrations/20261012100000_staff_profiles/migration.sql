-- Dashboard profile (about me + avatar). New table only; nothing existing is touched.
CREATE TABLE "staff_profiles" (
    "user_id" TEXT NOT NULL,
    "bio" TEXT,
    "avatar" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
