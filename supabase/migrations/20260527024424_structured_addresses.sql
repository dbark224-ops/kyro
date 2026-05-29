ALTER TABLE "contacts" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_locality" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_administrative_area" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_postal_code" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_country_code" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_latitude" numeric(12, 8);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_longitude" numeric(12, 8);--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_place_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_validation_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "address_structured" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_locality" text;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_administrative_area" text;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_postal_code" text;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_country_code" text;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_latitude" numeric(12, 8);--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_longitude" numeric(12, 8);--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_place_id" text;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_validation_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD COLUMN "address_structured" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "contacts_workspace_address_place_idx" ON "contacts" USING btree ("workspace_id","address_place_id") WHERE "contacts"."address_place_id" is not null;--> statement-breakpoint
CREATE INDEX "contacts_workspace_address_postal_idx" ON "contacts" USING btree ("workspace_id","address_country_code","address_postal_code") WHERE "contacts"."address_postal_code" is not null;--> statement-breakpoint
CREATE INDEX "inquiry_facts_workspace_address_place_idx" ON "inquiry_facts" USING btree ("workspace_id","address_place_id") WHERE "inquiry_facts"."address_place_id" is not null;
