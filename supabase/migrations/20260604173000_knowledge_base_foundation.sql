CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"citation" text,
	"jurisdiction_country" text DEFAULT 'Australia' NOT NULL,
	"jurisdiction_region" text,
	"industry" text,
	"topic_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_type" text NOT NULL,
	"licensing_mode" text NOT NULL,
	"publisher" text,
	"official_url" text,
	"purchase_url" text,
	"reference_code" text,
	"version_label" text,
	"effective_from" date,
	"effective_to" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sources_source_type_check"
		CHECK ("source_type" IN ('portal', 'act', 'regulation', 'guidance', 'code', 'standard_reference')),
	CONSTRAINT "knowledge_sources_licensing_mode_check"
		CHECK ("licensing_mode" IN ('public_ingest', 'metadata_only', 'restricted')),
	CONSTRAINT "knowledge_sources_status_check"
		CHECK ("status" IN ('active', 'draft', 'superseded', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "knowledge_sources_workspace_region_idx" ON "knowledge_sources" USING btree ("workspace_id","jurisdiction_region","industry","status");
--> statement-breakpoint
CREATE INDEX "knowledge_sources_global_region_idx" ON "knowledge_sources" USING btree ("jurisdiction_region","industry","status");
--> statement-breakpoint
CREATE INDEX "knowledge_sources_search_idx" ON "knowledge_sources" USING gin (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("notes", '') || ' ' || COALESCE("reference_code", '')));
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"source_id" uuid NOT NULL,
	"file_id" uuid,
	"storage_path" text,
	"title" text NOT NULL,
	"version_label" text,
	"published_at" timestamp with time zone,
	"effective_from" date,
	"effective_to" date,
	"checksum" text,
	"raw_text" text,
	"summary" text,
	"ingest_status" text DEFAULT 'pending' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_ingest_status_check"
		CHECK ("ingest_status" IN ('pending', 'ready', 'error', 'metadata_only'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "knowledge_documents_workspace_source_idx" ON "knowledge_documents" USING btree ("workspace_id","source_id","is_current","ingest_status");
--> statement-breakpoint
CREATE INDEX "knowledge_documents_current_idx" ON "knowledge_documents" USING btree ("source_id","is_current","published_at");
--> statement-breakpoint
CREATE INDEX "knowledge_documents_search_idx" ON "knowledge_documents" USING gin (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("summary", '') || ' ' || COALESCE("raw_text", '')));
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"document_id" uuid NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"heading" text,
	"section_label" text,
	"clause_ref" text,
	"topic_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"chunk_text" text NOT NULL,
	"chunk_summary" text,
	"token_count" integer,
	"embedding_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_chunk_idx" ON "knowledge_chunks" USING btree ("document_id","chunk_index");
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_workspace_document_idx" ON "knowledge_chunks" USING btree ("workspace_id","document_id");
--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING gin (to_tsvector('english', COALESCE("heading", '') || ' ' || COALESCE("section_label", '') || ' ' || COALESCE("clause_ref", '') || ' ' || COALESCE("chunk_summary", '') || ' ' || COALESCE("chunk_text", '')));
--> statement-breakpoint
CREATE TABLE "knowledge_change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"source_id" uuid NOT NULL,
	"document_id" uuid,
	"change_type" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_change_log_change_type_check"
		CHECK ("change_type" IN ('source_added', 'document_added', 'document_updated', 'document_superseded', 'ingest_failed', 'metadata_updated'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_change_log" ADD CONSTRAINT "knowledge_change_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_change_log" ADD CONSTRAINT "knowledge_change_log_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_change_log" ADD CONSTRAINT "knowledge_change_log_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "knowledge_change_log_source_detected_idx" ON "knowledge_change_log" USING btree ("source_id","detected_at");
--> statement-breakpoint
GRANT SELECT ON TABLE public.knowledge_sources TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.knowledge_documents TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.knowledge_chunks TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.knowledge_change_log TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_sources TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_documents TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_chunks TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_change_log TO service_role;
--> statement-breakpoint
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.knowledge_change_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY knowledge_sources_select_member
  ON public.knowledge_sources
  FOR SELECT
  TO authenticated
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY knowledge_documents_select_member
  ON public.knowledge_documents
  FOR SELECT
  TO authenticated
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY knowledge_chunks_select_member
  ON public.knowledge_chunks
  FOR SELECT
  TO authenticated
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY knowledge_change_log_select_member
  ON public.knowledge_change_log
  FOR SELECT
  TO authenticated
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_knowledge_sources_updated_at
  BEFORE UPDATE ON public.knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_knowledge_documents_updated_at
  BEFORE UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
