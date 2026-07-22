CREATE TABLE public.inquiry_future_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  calendar_event_id uuid REFERENCES public.conversation_appointments(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'calendar_confirmation',
  status text NOT NULL DEFAULT 'waiting',
  trigger_type text NOT NULL DEFAULT 'customer_reply',
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type text NOT NULL DEFAULT 'confirm_calendar_event',
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_approval boolean NOT NULL DEFAULT false,
  due_at timestamp with time zone,
  expires_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inquiry_future_steps_status_check CHECK (
    status IN ('waiting', 'needs_action', 'completed', 'cancelled', 'expired')
  )
);

CREATE INDEX inquiry_future_steps_workspace_status_idx
  ON public.inquiry_future_steps (workspace_id, status, due_at);

CREATE INDEX inquiry_future_steps_conversation_idx
  ON public.inquiry_future_steps (workspace_id, conversation_id, created_at DESC);

CREATE UNIQUE INDEX inquiry_future_steps_active_calendar_event_idx
  ON public.inquiry_future_steps (calendar_event_id)
  WHERE calendar_event_id IS NOT NULL AND status IN ('waiting', 'needs_action');

CREATE TRIGGER set_inquiry_future_steps_updated_at
  BEFORE UPDATE ON public.inquiry_future_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.inquiry_future_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY inquiry_future_steps_select_member
  ON public.inquiry_future_steps
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY inquiry_future_steps_insert_member
  ON public.inquiry_future_steps
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY inquiry_future_steps_update_member
  ON public.inquiry_future_steps
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY inquiry_future_steps_delete_member
  ON public.inquiry_future_steps
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
