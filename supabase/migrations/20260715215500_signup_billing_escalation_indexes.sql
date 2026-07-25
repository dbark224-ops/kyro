-- Supporting indexes for foreign-key maintenance and operational lookups.

CREATE INDEX signup_bootstrap_records_workspace_idx
  ON public.signup_bootstrap_records (workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX workspace_billing_access_latest_invoice_idx
  ON public.workspace_billing_access (latest_invoice_id)
  WHERE latest_invoice_id IS NOT NULL;

CREATE INDEX billing_dunning_deliveries_invoice_idx
  ON public.billing_dunning_deliveries (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX urgent_escalation_incidents_acknowledged_by_idx
  ON public.urgent_escalation_incidents (acknowledged_by_user_id)
  WHERE acknowledged_by_user_id IS NOT NULL;

CREATE INDEX urgent_escalation_steps_workspace_idx
  ON public.urgent_escalation_steps (workspace_id);
