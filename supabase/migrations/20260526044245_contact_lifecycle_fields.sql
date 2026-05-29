ALTER TABLE "contacts" ADD COLUMN "lifecycle_stage" text DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lifecycle_source" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lifecycle_reason" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lifecycle_reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "contacts_workspace_lifecycle_idx" ON "contacts" USING btree ("workspace_id","lifecycle_stage","lifecycle_source");
