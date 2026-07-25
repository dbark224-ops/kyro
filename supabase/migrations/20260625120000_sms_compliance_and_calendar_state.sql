CREATE TABLE "sms_recipient_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "contact_id" uuid,
  "phone_number" text NOT NULL,
  "normalized_phone" text NOT NULL,
  "channel_number_id" uuid,
  "consent_status" text DEFAULT 'unknown' NOT NULL,
  "source" text DEFAULT 'system' NOT NULL,
  "last_inbound_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "opted_out_at" timestamp with time zone,
  "opted_in_at" timestamp with time zone,
  "opt_out_keyword" text,
  "consent_note" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sms_recipient_preferences_consent_status_check"
    CHECK ("consent_status" IN ('unknown', 'opted_in', 'opted_out', 'blocked', 'staff_internal'))
);
--> statement-breakpoint
ALTER TABLE "sms_recipient_preferences" ADD CONSTRAINT "sms_recipient_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sms_recipient_preferences" ADD CONSTRAINT "sms_recipient_preferences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sms_recipient_preferences" ADD CONSTRAINT "sms_recipient_preferences_channel_number_id_workspace_phone_numbers_id_fk" FOREIGN KEY ("channel_number_id") REFERENCES "public"."workspace_phone_numbers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "sms_recipient_preferences_workspace_phone_idx" ON "sms_recipient_preferences" USING btree ("workspace_id","normalized_phone");
--> statement-breakpoint
CREATE INDEX "sms_recipient_preferences_workspace_status_idx" ON "sms_recipient_preferences" USING btree ("workspace_id","consent_status","updated_at");
--> statement-breakpoint
CREATE INDEX "sms_recipient_preferences_contact_idx" ON "sms_recipient_preferences" USING btree ("workspace_id","contact_id") WHERE "contact_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.conversation_appointments
  ADD COLUMN IF NOT EXISTS "external_calendar_provider" text,
  ADD COLUMN IF NOT EXISTS "external_calendar_id" text,
  ADD COLUMN IF NOT EXISTS "external_event_id" text,
  ADD COLUMN IF NOT EXISTS "external_event_etag" text,
  ADD COLUMN IF NOT EXISTS "external_sync_status" text DEFAULT 'not_synced' NOT NULL,
  ADD COLUMN IF NOT EXISTS "external_synced_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "external_sync_error" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_appointments_external_sync_idx"
  ON public.conversation_appointments USING btree ("workspace_id","external_sync_status","starts_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_appointments_external_event_idx"
  ON public.conversation_appointments USING btree ("workspace_id","external_calendar_provider","external_event_id")
  WHERE "external_calendar_provider" IS NOT NULL AND "external_event_id" IS NOT NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sms_recipient_preferences TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sms_recipient_preferences TO service_role;
--> statement-breakpoint
ALTER TABLE public.sms_recipient_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sms_recipient_preferences_select_member
  ON public.sms_recipient_preferences
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY sms_recipient_preferences_insert_member
  ON public.sms_recipient_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY sms_recipient_preferences_update_member
  ON public.sms_recipient_preferences
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY sms_recipient_preferences_delete_member
  ON public.sms_recipient_preferences
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_sms_recipient_preferences_updated_at
  BEFORE UPDATE ON public.sms_recipient_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
