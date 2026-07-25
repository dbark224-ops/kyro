ALTER TABLE public.workspace_phone_numbers
  ALTER COLUMN workspace_id DROP NOT NULL;

ALTER TABLE public.workspace_phone_numbers
  ADD COLUMN IF NOT EXISTS assigned_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reserved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS assignment_source text DEFAULT 'manual_pool' NOT NULL;

UPDATE public.workspace_phone_numbers
SET assigned_at = COALESCE(assigned_at, purchased_at, created_at),
    assignment_source = COALESCE(NULLIF(assignment_source, ''), 'legacy')
WHERE workspace_id IS NOT NULL;

ALTER TABLE public.workspace_phone_numbers
  DROP CONSTRAINT IF EXISTS workspace_phone_numbers_status_check;

ALTER TABLE public.workspace_phone_numbers
  ADD CONSTRAINT workspace_phone_numbers_status_check
  CHECK (status IN ('available', 'reserved', 'active', 'pending', 'released', 'failed'));

ALTER TABLE public.workspace_phone_numbers
  DROP CONSTRAINT IF EXISTS workspace_phone_numbers_assignment_source_check;

ALTER TABLE public.workspace_phone_numbers
  ADD CONSTRAINT workspace_phone_numbers_assignment_source_check
  CHECK (assignment_source IN ('manual_pool', 'admin_import', 'twilio_auto_purchase', 'legacy'));

CREATE INDEX IF NOT EXISTS workspace_phone_numbers_pool_available_idx
  ON public.workspace_phone_numbers (provider, country_code, status, created_at)
  WHERE workspace_id IS NULL AND status IN ('available', 'reserved');

CREATE UNIQUE INDEX IF NOT EXISTS workspace_phone_numbers_pool_provider_number_idx
  ON public.workspace_phone_numbers (provider, normalized_phone)
  WHERE workspace_id IS NULL AND status <> 'released';

DROP POLICY IF EXISTS workspace_phone_numbers_select_member
  ON public.workspace_phone_numbers;
DROP POLICY IF EXISTS workspace_phone_numbers_insert_member
  ON public.workspace_phone_numbers;
DROP POLICY IF EXISTS workspace_phone_numbers_update_member
  ON public.workspace_phone_numbers;
DROP POLICY IF EXISTS workspace_phone_numbers_delete_member
  ON public.workspace_phone_numbers;

CREATE POLICY workspace_phone_numbers_select_member
  ON public.workspace_phone_numbers
  FOR SELECT
  TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY workspace_phone_numbers_insert_member
  ON public.workspace_phone_numbers
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY workspace_phone_numbers_update_member
  ON public.workspace_phone_numbers
  FOR UPDATE
  TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY workspace_phone_numbers_delete_member
  ON public.workspace_phone_numbers
  FOR DELETE
  TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));
