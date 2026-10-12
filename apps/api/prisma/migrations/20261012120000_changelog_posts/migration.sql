-- Dashboard "Yangilanishlar" (release notes). New table only; nothing existing is touched.
CREATE TABLE "changelog_posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" TEXT,
    "link_url" TEXT,
    "link_label" TEXT,
    "image" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "changelog_posts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "changelog_posts_created_at_idx" ON "changelog_posts"("created_at");
