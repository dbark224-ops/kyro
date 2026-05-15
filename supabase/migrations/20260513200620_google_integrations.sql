CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connected_by_user_id" uuid,
	"provider" text NOT NULL,
	"service" text NOT NULL,
	"connection_key" text NOT NULL,
	"account_email" text,
	"account_name" text,
	"external_account_id" text,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_set" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"last_connected_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"state_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redirect_path" text DEFAULT '/settings' NOT NULL,
	"code_verifier" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_connections_workspace_idx" ON "integration_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "integration_connections_workspace_provider_idx" ON "integration_connections" USING btree ("workspace_id","provider","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_workspace_key_idx" ON "integration_connections" USING btree ("workspace_id","provider","connection_key");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_oauth_states_state_idx" ON "integration_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "integration_oauth_states_workspace_idx" ON "integration_oauth_states" USING btree ("workspace_id","provider","expires_at");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_integration_id_integration_connections_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER set_integration_connections_updated_at
  BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.integration_oauth_states ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_connections_select_member
  ON public.integration_connections
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY integration_connections_insert_member
  ON public.integration_connections
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY integration_connections_update_member
  ON public.integration_connections
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY integration_connections_delete_member
  ON public.integration_connections
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY integration_oauth_states_select_own
  ON public.integration_oauth_states
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id) AND user_id = auth.uid());--> statement-breakpoint
CREATE POLICY integration_oauth_states_insert_own
  ON public.integration_oauth_states
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = auth.uid());--> statement-breakpoint
CREATE POLICY integration_oauth_states_update_own
  ON public.integration_oauth_states
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id) AND user_id = auth.uid())
  WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = auth.uid());--> statement-breakpoint
CREATE POLICY integration_oauth_states_delete_own
  ON public.integration_oauth_states
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id) AND user_id = auth.uid());
