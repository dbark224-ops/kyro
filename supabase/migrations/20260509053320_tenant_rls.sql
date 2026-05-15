-- Supabase tenant isolation and audit foundations.

ALTER TABLE public.users
  ADD CONSTRAINT users_id_auth_users_id_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = check_workspace_id
      AND wm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(check_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = check_workspace_id
      AND w.owner_user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO service_role;

CREATE TRIGGER set_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_business_profiles_updated_at
  BEFORE UPDATE ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_workspace_policies_updated_at
  BEFORE UPDATE ON public.workspace_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_workspace_entitlements_updated_at
  BEFORE UPDATE ON public.workspace_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_channels_updated_at
  BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_model_routes_updated_at
  BEFORE UPDATE ON public.model_routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_actions_updated_at
  BEFORE UPDATE ON public.actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_usage_rollups_updated_at
  BEFORE UPDATE ON public.usage_rollups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_pricing_rules_updated_at
  BEFORE UPDATE ON public.pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_workspace_budgets_updated_at
  BEFORE UPDATE ON public.workspace_budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY users_insert_own
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY users_update_own
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY workspaces_select_member
  ON public.workspaces
  FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid() OR public.is_workspace_member(id));

CREATE POLICY workspaces_insert_owner
  ON public.workspaces
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY workspaces_update_member
  ON public.workspaces
  FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid() OR public.is_workspace_member(id))
  WITH CHECK (owner_user_id = auth.uid() OR public.is_workspace_member(id));

CREATE POLICY workspace_members_select_member
  ON public.workspace_members
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY workspace_members_insert_owner_or_member
  ON public.workspace_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    OR public.is_workspace_owner(workspace_id)
  );

CREATE POLICY workspace_members_update_member
  ON public.workspace_members
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY workspace_members_delete_member
  ON public.workspace_members
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'business_profiles',
    'channels',
    'contacts',
    'conversations',
    'files',
    'leads',
    'messages',
    'events',
    'workflow_runs',
    'ai_runs',
    'model_route_decisions',
    'actions',
    'usage_rollups',
    'workspace_budgets',
    'workspace_entitlements',
    'workspace_policies'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id))',
      table_name || '_select_member',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id))',
      table_name || '_insert_member',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id))',
      table_name || '_update_member',
      table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_workspace_member(workspace_id))',
      table_name || '_delete_member',
      table_name
    );
  END LOOP;
END;
$$;

CREATE POLICY model_routes_select_global_or_member
  ON public.model_routes
  FOR SELECT
  TO authenticated
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));

CREATE POLICY model_routes_insert_member
  ON public.model_routes
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY model_routes_update_member
  ON public.model_routes
  FOR UPDATE
  TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY model_routes_delete_member
  ON public.model_routes
  FOR DELETE
  TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY pricing_rules_select_global_or_member
  ON public.pricing_rules
  FOR SELECT
  TO authenticated
  USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));

CREATE POLICY pricing_rules_insert_member
  ON public.pricing_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY pricing_rules_update_member
  ON public.pricing_rules
  FOR UPDATE
  TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id))
  WITH CHECK (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY pricing_rules_delete_member
  ON public.pricing_rules
  FOR DELETE
  TO authenticated
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(workspace_id));

CREATE POLICY audit_logs_select_member
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY audit_logs_insert_member
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY usage_events_select_member
  ON public.usage_events
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY usage_events_insert_member
  ON public.usage_events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));
