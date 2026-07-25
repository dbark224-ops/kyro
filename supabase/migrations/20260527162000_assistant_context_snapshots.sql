CREATE TABLE "assistant_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"snapshot_type" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_context_snapshots_snapshot_type_check"
		CHECK ("snapshot_type" IN ('rolling', 'daily', 'weekly', 'monthly', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "assistant_context_snapshots" ADD CONSTRAINT "assistant_context_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_context_snapshots" ADD CONSTRAINT "assistant_context_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_context_snapshots" ADD CONSTRAINT "assistant_context_snapshots_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_context_snapshots_unique_period_idx" ON "assistant_context_snapshots" USING btree ("workspace_id","user_id","thread_id","snapshot_type","period_start");
--> statement-breakpoint
CREATE INDEX "assistant_context_snapshots_thread_period_idx" ON "assistant_context_snapshots" USING btree ("workspace_id","user_id","thread_id","snapshot_type","period_end");
--> statement-breakpoint
CREATE INDEX "assistant_context_snapshots_workspace_period_idx" ON "assistant_context_snapshots" USING btree ("workspace_id","user_id","snapshot_type","period_end");
--> statement-breakpoint
CREATE INDEX "assistant_context_snapshots_summary_search_idx" ON "assistant_context_snapshots" USING gin (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("summary", '')));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_context_snapshots TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_context_snapshots TO service_role;
--> statement-breakpoint
ALTER TABLE public.assistant_context_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY assistant_context_snapshots_select_member
  ON public.assistant_context_snapshots
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_context_snapshots_insert_member
  ON public.assistant_context_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_context_snapshots_update_member
  ON public.assistant_context_snapshots
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_context_snapshots_delete_member
  ON public.assistant_context_snapshots
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_assistant_context_snapshots_updated_at
  BEFORE UPDATE ON public.assistant_context_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
