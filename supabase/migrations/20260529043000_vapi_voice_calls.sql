CREATE TABLE "voice_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid,
	"contact_id" uuid,
	"lead_id" uuid,
	"phone_number_id" uuid,
	"direction" text NOT NULL,
	"purpose" text DEFAULT 'inbound_customer' NOT NULL,
	"provider" text DEFAULT 'vapi' NOT NULL,
	"carrier_provider" text DEFAULT 'twilio' NOT NULL,
	"provider_call_id" text,
	"provider_assistant_id" text,
	"provider_phone_number_id" text,
	"from_number" text,
	"to_number" text,
	"normalized_from_number" text,
	"normalized_to_number" text,
	"customer_number" text,
	"status" text DEFAULT 'created' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"recording_url" text,
	"transcript" text,
	"summary" text,
	"ended_reason" text,
	"cost_provider_amount" numeric DEFAULT '0' NOT NULL,
	"cost_customer_amount" numeric DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_calls_direction_check"
		CHECK ("direction" IN ('inbound', 'outbound')),
	CONSTRAINT "voice_calls_purpose_check"
		CHECK ("purpose" IN ('voicemail_overflow', 'inbound_customer', 'inbound_user', 'outbound_customer', 'test')),
	CONSTRAINT "voice_calls_status_check"
		CHECK ("status" IN ('created', 'queued', 'ringing', 'in_progress', 'completed', 'failed', 'missed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "voice_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"voice_call_id" uuid,
	"provider" text DEFAULT 'vapi' NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_phone_number_id_workspace_phone_numbers_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."workspace_phone_numbers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voice_call_events" ADD CONSTRAINT "voice_call_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "voice_call_events" ADD CONSTRAINT "voice_call_events_voice_call_id_voice_calls_id_fk" FOREIGN KEY ("voice_call_id") REFERENCES "public"."voice_calls"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "voice_calls_workspace_created_idx" ON "voice_calls" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX "voice_calls_workspace_status_idx" ON "voice_calls" USING btree ("workspace_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "voice_calls_workspace_contact_idx" ON "voice_calls" USING btree ("workspace_id","contact_id","created_at") WHERE "contact_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "voice_calls_provider_call_idx" ON "voice_calls" USING btree ("provider","provider_call_id") WHERE "provider_call_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "voice_call_events_workspace_created_idx" ON "voice_call_events" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX "voice_call_events_call_created_idx" ON "voice_call_events" USING btree ("workspace_id","voice_call_id","created_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_calls TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_calls TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_call_events TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_call_events TO service_role;
--> statement-breakpoint
ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.voice_call_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY voice_calls_select_member
  ON public.voice_calls
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY voice_calls_insert_member
  ON public.voice_calls
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY voice_calls_update_member
  ON public.voice_calls
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY voice_calls_delete_member
  ON public.voice_calls
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY voice_call_events_select_member
  ON public.voice_call_events
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY voice_call_events_insert_member
  ON public.voice_call_events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY voice_call_events_update_member
  ON public.voice_call_events
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY voice_call_events_delete_member
  ON public.voice_call_events
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_voice_calls_updated_at
  BEFORE UPDATE ON public.voice_calls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
