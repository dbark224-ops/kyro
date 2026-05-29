CREATE TABLE "conversation_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"contact_id" uuid,
	"lead_id" uuid,
	"task_id" uuid,
	"created_by_user_id" uuid,
	"source_action_id" uuid,
	"appointment_type" text DEFAULT 'site_visit' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'suggested' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"location" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"contact_id" uuid,
	"lead_id" uuid,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"contact_id" uuid,
	"lead_id" uuid,
	"assigned_to_user_id" uuid,
	"created_by_user_id" uuid,
	"source_action_id" uuid,
	"task_type" text DEFAULT 'manual_task' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_appointments" ADD CONSTRAINT "conversation_appointments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_appointments" ADD CONSTRAINT "conversation_appointments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_appointments" ADD CONSTRAINT "conversation_appointments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_appointments" ADD CONSTRAINT "conversation_appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_appointments" ADD CONSTRAINT "conversation_appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_appointments" ADD CONSTRAINT "conversation_appointments_task_id_conversation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."conversation_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_appointments" ADD CONSTRAINT "conversation_appointments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_appointments" ADD CONSTRAINT "conversation_appointments_source_action_id_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tasks" ADD CONSTRAINT "conversation_tasks_source_action_id_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_appointments_workspace_status_idx" ON "conversation_appointments" USING btree ("workspace_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "conversation_appointments_conversation_idx" ON "conversation_appointments" USING btree ("workspace_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_appointments_task_idx" ON "conversation_appointments" USING btree ("workspace_id","task_id");--> statement-breakpoint
CREATE INDEX "conversation_notes_conversation_idx" ON "conversation_notes" USING btree ("workspace_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_notes_message_idx" ON "conversation_notes" USING btree ("workspace_id","message_id");--> statement-breakpoint
CREATE INDEX "conversation_tasks_workspace_status_idx" ON "conversation_tasks" USING btree ("workspace_id","status","due_at");--> statement-breakpoint
CREATE INDEX "conversation_tasks_conversation_idx" ON "conversation_tasks" USING btree ("workspace_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_tasks_message_idx" ON "conversation_tasks" USING btree ("workspace_id","message_id");--> statement-breakpoint
CREATE INDEX "conversation_tasks_assignee_idx" ON "conversation_tasks" USING btree ("workspace_id","assigned_to_user_id","status");--> statement-breakpoint
CREATE TRIGGER set_conversation_tasks_updated_at
  BEFORE UPDATE ON public.conversation_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_conversation_appointments_updated_at
  BEFORE UPDATE ON public.conversation_appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_conversation_notes_updated_at
  BEFORE UPDATE ON public.conversation_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
ALTER TABLE public.conversation_tasks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.conversation_appointments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.conversation_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY conversation_tasks_select_member
  ON public.conversation_tasks
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_tasks_insert_member
  ON public.conversation_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_tasks_update_member
  ON public.conversation_tasks
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_tasks_delete_member
  ON public.conversation_tasks
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_appointments_select_member
  ON public.conversation_appointments
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_appointments_insert_member
  ON public.conversation_appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_appointments_update_member
  ON public.conversation_appointments
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_appointments_delete_member
  ON public.conversation_appointments
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_notes_select_member
  ON public.conversation_notes
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_notes_insert_member
  ON public.conversation_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_notes_update_member
  ON public.conversation_notes
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));--> statement-breakpoint
CREATE POLICY conversation_notes_delete_member
  ON public.conversation_notes
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
