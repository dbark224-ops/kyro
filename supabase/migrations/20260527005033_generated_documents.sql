CREATE TABLE "generated_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"lifecycle_status" text DEFAULT 'generated' NOT NULL,
	"title" text NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"conversation_id" uuid,
	"quote_draft_id" uuid,
	"file_id" uuid,
	"storage_bucket" text,
	"storage_path" text,
	"filename" text NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"renderer" text,
	"document_version" text,
	"google_drive_file_id" text,
	"google_drive_web_url" text,
	"google_drive_synced_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"sent_message_id" uuid,
	"sent_at" timestamp with time zone,
	"filed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_quote_draft_id_quote_drafts_id_fk" FOREIGN KEY ("quote_draft_id") REFERENCES "public"."quote_drafts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_sent_message_id_messages_id_fk" FOREIGN KEY ("sent_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "generated_documents_workspace_status_idx" ON "generated_documents" USING btree ("workspace_id","lifecycle_status","updated_at");
--> statement-breakpoint
CREATE INDEX "generated_documents_workspace_type_idx" ON "generated_documents" USING btree ("workspace_id","document_type","updated_at");
--> statement-breakpoint
CREATE INDEX "generated_documents_contact_idx" ON "generated_documents" USING btree ("workspace_id","contact_id","updated_at");
--> statement-breakpoint
CREATE INDEX "generated_documents_conversation_idx" ON "generated_documents" USING btree ("workspace_id","conversation_id","updated_at");
--> statement-breakpoint
CREATE INDEX "generated_documents_quote_draft_idx" ON "generated_documents" USING btree ("workspace_id","quote_draft_id","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "generated_documents_quote_content_idx" ON "generated_documents" USING btree ("workspace_id","quote_draft_id","document_type","content_hash") WHERE "quote_draft_id" IS NOT NULL AND "content_hash" IS NOT NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.generated_documents TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.generated_documents TO service_role;
--> statement-breakpoint
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY generated_documents_select_member
  ON public.generated_documents
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY generated_documents_insert_member
  ON public.generated_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY generated_documents_update_member
  ON public.generated_documents
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY generated_documents_delete_member
  ON public.generated_documents
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_generated_documents_updated_at
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
