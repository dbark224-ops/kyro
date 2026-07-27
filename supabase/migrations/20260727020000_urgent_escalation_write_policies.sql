-- Urgent escalation could be read but never written.
--
-- Both escalation tables were created with RLS enabled and a select policy
-- only. No insert, update or delete policy was ever added, so every attempt to
-- raise an incident from a user-context client was refused:
--
--   new row violates row-level security policy for table
--   "urgent_escalation_incidents"
--
-- Which means urgent escalation has never fired for inbound email. It looked
-- like a feature; it was a select-only table.
--
-- Every other workspace-scoped table -- conversations, events, actions -- has
-- the full member set, so this is the missing half of an established pattern
-- rather than a new grant: is_workspace_member(workspace_id) on USING for read
-- paths, WITH CHECK on write paths, so a member can only ever touch rows in a
-- workspace they belong to.

CREATE POLICY urgent_escalation_incidents_insert_member
  ON public.urgent_escalation_incidents
  FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY urgent_escalation_incidents_update_member
  ON public.urgent_escalation_incidents
  FOR UPDATE
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY urgent_escalation_incidents_delete_member
  ON public.urgent_escalation_incidents
  FOR DELETE
  USING (is_workspace_member(workspace_id));

CREATE POLICY urgent_escalation_steps_insert_member
  ON public.urgent_escalation_steps
  FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY urgent_escalation_steps_update_member
  ON public.urgent_escalation_steps
  FOR UPDATE
  USING (is_workspace_member(workspace_id))
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY urgent_escalation_steps_delete_member
  ON public.urgent_escalation_steps
  FOR DELETE
  USING (is_workspace_member(workspace_id));
