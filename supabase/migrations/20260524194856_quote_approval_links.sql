CREATE TABLE "quote_approval_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"quote_draft_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"customer_email" text,
	"expires_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"changes_requested_at" timestamp with time zone,
	"last_change_request" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_approval_links" ADD CONSTRAINT "quote_approval_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_approval_links" ADD CONSTRAINT "quote_approval_links_quote_draft_id_quote_drafts_id_fk" FOREIGN KEY ("quote_draft_id") REFERENCES "public"."quote_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_approval_links_token_hash_idx" ON "quote_approval_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "quote_approval_links_workspace_idx" ON "quote_approval_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "quote_approval_links_quote_idx" ON "quote_approval_links" USING btree ("workspace_id","quote_draft_id");--> statement-breakpoint
CREATE INDEX "quote_approval_links_status_idx" ON "quote_approval_links" USING btree ("workspace_id","status");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_approval_links TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_approval_links TO service_role;
--> statement-breakpoint
ALTER TABLE public.quote_approval_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quote_approval_links_select_member
  ON public.quote_approval_links
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY quote_approval_links_insert_member
  ON public.quote_approval_links
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY quote_approval_links_update_member
  ON public.quote_approval_links
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY quote_approval_links_delete_member
  ON public.quote_approval_links
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_quote_approval_links_updated_at
  BEFORE UPDATE ON public.quote_approval_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
