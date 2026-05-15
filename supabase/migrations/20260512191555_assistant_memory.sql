CREATE TABLE "assistant_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"source_thread_id" uuid,
	"source_message_id" uuid,
	"memory_type" text DEFAULT 'preference' NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence" numeric DEFAULT '1' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid,
	"ai_run_id" uuid,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"intent" text,
	"provider" text,
	"model" text,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ui_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"title" text DEFAULT 'Assistant thread' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"summary" text,
	"summary_updated_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_source_thread_id_assistant_threads_id_fk" FOREIGN KEY ("source_thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_source_message_id_assistant_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."assistant_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_memories_workspace_status_idx" ON "assistant_memories" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_memories_source_thread_idx" ON "assistant_memories" USING btree ("workspace_id","source_thread_id");--> statement-breakpoint
CREATE INDEX "assistant_messages_thread_created_idx" ON "assistant_messages" USING btree ("workspace_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_ai_run_idx" ON "assistant_messages" USING btree ("workspace_id","ai_run_id");--> statement-breakpoint
CREATE INDEX "assistant_threads_workspace_user_idx" ON "assistant_threads" USING btree ("workspace_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_threads_workspace_status_idx" ON "assistant_threads" USING btree ("workspace_id","status");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_threads TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_threads TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_messages TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_messages TO service_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_memories TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_memories TO service_role;
--> statement-breakpoint
ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.assistant_memories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY assistant_threads_select_member
  ON public.assistant_threads
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_threads_insert_member
  ON public.assistant_threads
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_threads_update_member
  ON public.assistant_threads
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_threads_delete_member
  ON public.assistant_threads
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_messages_select_member
  ON public.assistant_messages
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_messages_insert_member
  ON public.assistant_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_messages_update_member
  ON public.assistant_messages
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_messages_delete_member
  ON public.assistant_messages
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_memories_select_member
  ON public.assistant_memories
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_memories_insert_member
  ON public.assistant_memories
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_memories_update_member
  ON public.assistant_memories
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_memories_delete_member
  ON public.assistant_memories
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_assistant_threads_updated_at
  BEFORE UPDATE ON public.assistant_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER set_assistant_memories_updated_at
  BEFORE UPDATE ON public.assistant_memories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
