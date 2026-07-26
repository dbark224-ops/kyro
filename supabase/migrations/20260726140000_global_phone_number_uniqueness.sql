-- A phone number must belong to at most one workspace.
--
-- Uniqueness was enforced per workspace -- (workspace_id, normalized_phone) --
-- and globally only for unassigned pool rows, WHERE workspace_id IS NULL.
-- Nothing covered the case that matters: the same number assigned to two
-- different workspaces at once.
--
-- That is not a cosmetic gap. Inbound SMS and voice both resolve the
-- destination number with .limit(1).maybeSingle(), so Postgres would silently
-- pick one of the two rows and a customer's reply would land in a stranger's
-- inbox. Silent, and near-impossible to reproduce after the fact.
--
-- Safe to add: every write to this table in application code is an UPDATE
-- (numbers are seeded by an admin and claimed by setting workspace_id), and a
-- duplicate check across all non-released rows returned nothing before this ran.
--
-- This subsumes workspace_phone_numbers_pool_provider_number_idx, which covered
-- only the workspace_id IS NULL slice of the same condition.

CREATE UNIQUE INDEX IF NOT EXISTS workspace_phone_numbers_provider_number_idx
  ON public.workspace_phone_numbers (provider, normalized_phone)
  WHERE status <> 'released';

DROP INDEX IF EXISTS public.workspace_phone_numbers_pool_provider_number_idx;
