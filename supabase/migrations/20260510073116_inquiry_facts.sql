CREATE TABLE "inquiry_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"source_ai_run_id" uuid,
	"job_type" text,
	"address" text,
	"preferred_time" text,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"budget" text,
	"fit" text DEFAULT 'needs_review' NOT NULL,
	"missing_info" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"edited_by_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_source_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("source_ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_facts" ADD CONSTRAINT "inquiry_facts_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_facts_workspace_conversation_idx" ON "inquiry_facts" USING btree ("workspace_id","conversation_id");--> statement-breakpoint
CREATE INDEX "inquiry_facts_workspace_lead_idx" ON "inquiry_facts" USING btree ("workspace_id","lead_id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inquiry_facts TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inquiry_facts TO service_role;
--> statement-breakpoint
ALTER TABLE public.inquiry_facts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inquiry_facts_select_member
  ON public.inquiry_facts
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY inquiry_facts_insert_member
  ON public.inquiry_facts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY inquiry_facts_update_member
  ON public.inquiry_facts
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY inquiry_facts_delete_member
  ON public.inquiry_facts
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_inquiry_facts_updated_at
  BEFORE UPDATE ON public.inquiry_facts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
