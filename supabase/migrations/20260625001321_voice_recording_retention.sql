ALTER TABLE "voice_calls"
  ADD COLUMN IF NOT EXISTS "recording_retention_days" integer DEFAULT 30 NOT NULL,
  ADD COLUMN IF NOT EXISTS "recording_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "recording_deleted_at" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'voice_calls_recording_retention_days_check'
  ) THEN
    ALTER TABLE "voice_calls"
      ADD CONSTRAINT "voice_calls_recording_retention_days_check"
      CHECK (
        "recording_retention_days" >= 1
        AND "recording_retention_days" <= 365
      );
  END IF;
END $$;

UPDATE "voice_calls"
SET "recording_expires_at" = COALESCE(
    "recording_expires_at",
    COALESCE("ended_at", "started_at", "created_at") + interval '30 days'
  ),
  "recording_retention_days" = COALESCE("recording_retention_days", 30)
WHERE "recording_url" IS NOT NULL
  AND "recording_deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "voice_calls_recording_retention_due_idx"
  ON "voice_calls" ("recording_expires_at")
  WHERE "recording_url" IS NOT NULL
    AND "recording_deleted_at" IS NULL;
