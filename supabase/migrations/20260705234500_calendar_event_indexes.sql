CREATE INDEX IF NOT EXISTS conversation_appointments_workspace_starts_idx
  ON public.conversation_appointments USING btree (workspace_id, starts_at);

CREATE INDEX IF NOT EXISTS conversation_appointments_workspace_contact_starts_idx
  ON public.conversation_appointments USING btree (workspace_id, contact_id, starts_at)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_appointments_workspace_lead_starts_idx
  ON public.conversation_appointments USING btree (workspace_id, lead_id, starts_at)
  WHERE lead_id IS NOT NULL;
