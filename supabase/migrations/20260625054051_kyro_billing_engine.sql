CREATE TABLE IF NOT EXISTS public.kyro_billing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'USD',
  subtotal_amount numeric NOT NULL DEFAULT 0,
  usage_amount numeric NOT NULL DEFAULT 0,
  base_subscription_amount numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  provider_cost_amount numeric NOT NULL DEFAULT 0,
  invoice_id uuid,
  generated_at timestamp with time zone,
  closed_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT kyro_billing_periods_valid_period CHECK (period_start < period_end)
);

CREATE UNIQUE INDEX IF NOT EXISTS kyro_billing_periods_workspace_period_idx
  ON public.kyro_billing_periods(workspace_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS kyro_billing_periods_workspace_status_idx
  ON public.kyro_billing_periods(workspace_id, status, period_end);

CREATE TABLE IF NOT EXISTS public.kyro_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  billing_period_id uuid REFERENCES public.kyro_billing_periods(id),
  invoice_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'USD',
  subtotal_amount numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  provider_cost_amount numeric NOT NULL DEFAULT 0,
  stripe_customer_id text,
  stripe_payment_method_id text,
  stripe_payment_intent_id text,
  stripe_last_event_id text,
  failure_count integer NOT NULL DEFAULT 0,
  last_error text,
  issued_at timestamp with time zone,
  due_at timestamp with time zone,
  paid_at timestamp with time zone,
  failed_at timestamp with time zone,
  next_retry_at timestamp with time zone,
  voided_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kyro_invoices_invoice_number_idx
  ON public.kyro_invoices(invoice_number);

CREATE UNIQUE INDEX IF NOT EXISTS kyro_invoices_billing_period_idx
  ON public.kyro_invoices(billing_period_id)
  WHERE billing_period_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS kyro_invoices_workspace_status_idx
  ON public.kyro_invoices(workspace_id, status, due_at);

CREATE INDEX IF NOT EXISTS kyro_invoices_stripe_payment_intent_idx
  ON public.kyro_invoices(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.kyro_invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  invoice_id uuid NOT NULL REFERENCES public.kyro_invoices(id) ON DELETE CASCADE,
  billing_period_id uuid REFERENCES public.kyro_billing_periods(id),
  source_type text,
  source_id uuid,
  kind text NOT NULL,
  description text NOT NULL,
  provider text,
  service text,
  usage_type text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_amount numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyro_invoice_line_items_invoice_idx
  ON public.kyro_invoice_line_items(invoice_id);

CREATE INDEX IF NOT EXISTS kyro_invoice_line_items_workspace_period_idx
  ON public.kyro_invoice_line_items(workspace_id, billing_period_id);

ALTER TABLE public.kyro_billing_periods
  ADD CONSTRAINT kyro_billing_periods_invoice_id_fk
  FOREIGN KEY (invoice_id) REFERENCES public.kyro_invoices(id);

CREATE TRIGGER set_kyro_billing_periods_updated_at
  BEFORE UPDATE ON public.kyro_billing_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_kyro_invoices_updated_at
  BEFORE UPDATE ON public.kyro_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyro_billing_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyro_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyro_invoice_line_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyro_billing_periods TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyro_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyro_invoice_line_items TO service_role;

ALTER TABLE public.kyro_billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyro_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyro_invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY kyro_billing_periods_select_member
  ON public.kyro_billing_periods
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_billing_periods_insert_member
  ON public.kyro_billing_periods
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_billing_periods_update_member
  ON public.kyro_billing_periods
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_billing_periods_delete_member
  ON public.kyro_billing_periods
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_invoices_select_member
  ON public.kyro_invoices
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_invoices_insert_member
  ON public.kyro_invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_invoices_update_member
  ON public.kyro_invoices
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_invoices_delete_member
  ON public.kyro_invoices
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_invoice_line_items_select_member
  ON public.kyro_invoice_line_items
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_invoice_line_items_insert_member
  ON public.kyro_invoice_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_invoice_line_items_update_member
  ON public.kyro_invoice_line_items
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY kyro_invoice_line_items_delete_member
  ON public.kyro_invoice_line_items
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));
