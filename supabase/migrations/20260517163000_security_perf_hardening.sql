-- Kyro security and performance hardening.
-- This migration is designed to be additive and low-risk:
-- - Keep workspace membership semantics unchanged.
-- - Remove SECURITY DEFINER functions from exposed schemas.
-- - Reduce RLS per-row auth function re-evaluation.
-- - Add only missing foreign-key indexes.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_workspace_member(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = check_workspace_id
      AND wm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_owner(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = check_workspace_id
      AND w.owner_user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION private.is_workspace_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_workspace_owner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.is_workspace_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.is_workspace_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.is_workspace_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_owner(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.is_workspace_member(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, private
STABLE
AS $$
  SELECT private.is_workspace_member(check_workspace_id);
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, private
STABLE
AS $$
  SELECT private.is_workspace_owner(check_workspace_id);
$$;

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_owner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_workspace_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS users_insert_own ON public.users;
CREATE POLICY users_insert_own
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS workspaces_select_member ON public.workspaces;
CREATE POLICY workspaces_select_member
  ON public.workspaces
  FOR SELECT
  TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) OR public.is_workspace_member(id));

DROP POLICY IF EXISTS workspaces_insert_owner ON public.workspaces;
CREATE POLICY workspaces_insert_owner
  ON public.workspaces
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS workspaces_update_member ON public.workspaces;
CREATE POLICY workspaces_update_member
  ON public.workspaces
  FOR UPDATE
  TO authenticated
  USING (owner_user_id = (SELECT auth.uid()) OR public.is_workspace_member(id))
  WITH CHECK (owner_user_id = (SELECT auth.uid()) OR public.is_workspace_member(id));

DROP POLICY IF EXISTS integration_oauth_states_select_own ON public.integration_oauth_states;
CREATE POLICY integration_oauth_states_select_own
  ON public.integration_oauth_states
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS integration_oauth_states_insert_own ON public.integration_oauth_states;
CREATE POLICY integration_oauth_states_insert_own
  ON public.integration_oauth_states
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS integration_oauth_states_update_own ON public.integration_oauth_states;
CREATE POLICY integration_oauth_states_update_own
  ON public.integration_oauth_states
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id) AND user_id = (SELECT auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS integration_oauth_states_delete_own ON public.integration_oauth_states;
CREATE POLICY integration_oauth_states_delete_own
  ON public.integration_oauth_states
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id) AND user_id = (SELECT auth.uid()));

DO $$
DECLARE
  rec record;
  index_name text;
  index_columns text;
BEGIN
  FOR rec IN
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      c.conname AS constraint_name,
      c.conkey AS fk_columns
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indpred IS NULL
          AND i.indisvalid
          AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1] OPERATOR(pg_catalog.@>) c.conkey
      )
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY x.ord)
      INTO index_columns
    FROM unnest(rec.fk_columns) WITH ORDINALITY AS x(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = format('%I.%I', rec.schema_name, rec.table_name)::regclass
                       AND a.attnum = x.attnum;

    index_name := format(
      'idx_%s_%s_fk',
      rec.table_name,
      substring(md5(rec.constraint_name) FROM 1 FOR 10)
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I USING btree (%s)',
      index_name,
      rec.schema_name,
      rec.table_name,
      index_columns
    );
  END LOOP;
END;
$$;
