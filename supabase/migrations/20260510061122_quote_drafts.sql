CREATE TABLE "quote_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"conversation_id" uuid,
	"source_action_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_drafts" ADD CONSTRAINT "quote_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_drafts" ADD CONSTRAINT "quote_drafts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_drafts" ADD CONSTRAINT "quote_drafts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_drafts" ADD CONSTRAINT "quote_drafts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_drafts" ADD CONSTRAINT "quote_drafts_source_action_id_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_drafts_workspace_idx" ON "quote_drafts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "quote_drafts_conversation_idx" ON "quote_drafts" USING btree ("workspace_id","conversation_id");--> statement-breakpoint
CREATE INDEX "quote_drafts_lead_idx" ON "quote_drafts" USING btree ("workspace_id","lead_id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_drafts TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_drafts TO service_role;
--> statement-breakpoint
ALTER TABLE public.quote_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quote_drafts_select_member
  ON public.quote_drafts
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY quote_drafts_insert_member
  ON public.quote_drafts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY quote_drafts_update_member
  ON public.quote_drafts
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY quote_drafts_delete_member
  ON public.quote_drafts
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_quote_drafts_updated_at
  BEFORE UPDATE ON public.quote_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
