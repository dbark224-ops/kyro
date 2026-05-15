ALTER TABLE "contacts" ADD COLUMN "contact_type" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address" text;--> statement-breakpoint
CREATE INDEX "contacts_workspace_type_idx" ON "contacts" USING btree ("workspace_id","contact_type");