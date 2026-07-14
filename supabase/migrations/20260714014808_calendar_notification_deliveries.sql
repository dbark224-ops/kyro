CREATE TABLE public.calendar_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid,
  appointment_id uuid,
  notification_type text NOT NULL,
  idempotency_key text NOT NULL,
  scheduled_for timestamp with time zone NOT NULL,
  target_date text,
  recipient_phone text,
  body text,
  provider text,
  provider_message_id text,
  provider_request_id text,
  status text DEFAULT 'pending' NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  error text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT calendar_notification_deliveries_type_check
    CHECK (notification_type IN ('calendar_event_reminder', 'calendar_daily_digest')),
  CONSTRAINT calendar_notification_deliveries_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE public.calendar_notification_deliveries
  ADD CONSTRAINT calendar_notification_deliveries_workspace_id_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE public.calendar_notification_deliveries
  ADD CONSTRAINT calendar_notification_deliveries_appointment_id_conversation_appointments_id_fk
  FOREIGN KEY (appointment_id) REFERENCES public.conversation_appointments(id) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX calendar_notification_deliveries_idempotency_idx
  ON public.calendar_notification_deliveries USING btree (idempotency_key);
--> statement-breakpoint
CREATE INDEX calendar_notification_deliveries_due_idx
  ON public.calendar_notification_deliveries USING btree (status, scheduled_for);
--> statement-breakpoint
CREATE INDEX calendar_notification_deliveries_workspace_type_idx
  ON public.calendar_notification_deliveries USING btree (workspace_id, notification_type, scheduled_for DESC);
--> statement-breakpoint
CREATE INDEX calendar_notification_deliveries_appointment_idx
  ON public.calendar_notification_deliveries USING btree (workspace_id, appointment_id)
  WHERE appointment_id IS NOT NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.calendar_notification_deliveries TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.calendar_notification_deliveries TO service_role;
--> statement-breakpoint
ALTER TABLE public.calendar_notification_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_notification_deliveries_select_member
  ON public.calendar_notification_deliveries
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY calendar_notification_deliveries_insert_member
  ON public.calendar_notification_deliveries
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY calendar_notification_deliveries_update_member
  ON public.calendar_notification_deliveries
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY calendar_notification_deliveries_delete_member
  ON public.calendar_notification_deliveries
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE TRIGGER set_calendar_notification_deliveries_updated_at
  BEFORE UPDATE ON public.calendar_notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
