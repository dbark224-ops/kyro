CREATE TABLE "assistant_prompt_suggestion_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'weekly' NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_prompt_suggestion_sets_status_check"
		CHECK ("status" IN ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "assistant_prompt_suggestion_sets" ADD CONSTRAINT "assistant_prompt_suggestion_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assistant_prompt_suggestion_sets" ADD CONSTRAINT "assistant_prompt_suggestion_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "assistant_prompt_suggestion_sets_active_idx" ON "assistant_prompt_suggestion_sets" USING btree ("workspace_id","user_id","status","generated_at");
--> statement-breakpoint
CREATE INDEX "assistant_prompt_suggestion_sets_period_idx" ON "assistant_prompt_suggestion_sets" USING btree ("workspace_id","user_id","period_end");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_prompt_suggestion_sets TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assistant_prompt_suggestion_sets TO service_role;
--> statement-breakpoint
ALTER TABLE public.assistant_prompt_suggestion_sets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY assistant_prompt_suggestion_sets_select_member
  ON public.assistant_prompt_suggestion_sets
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_prompt_suggestion_sets_insert_member
  ON public.assistant_prompt_suggestion_sets
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_prompt_suggestion_sets_update_member
  ON public.assistant_prompt_suggestion_sets
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_prompt_suggestion_sets_delete_member
  ON public.assistant_prompt_suggestion_sets
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_assistant_prompt_suggestion_sets_updated_at
  BEFORE UPDATE ON public.assistant_prompt_suggestion_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
