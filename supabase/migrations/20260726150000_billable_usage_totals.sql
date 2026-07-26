-- Totals for a billing period, computed in the database.
--
-- The app chrome draws two or three usage pills on every authenticated page
-- render. Each one called getBillableUsageSummary, which paged through every
-- raw usage_events row for the period (1,000 at a time, up to 100,000) and
-- aggregated them in JavaScript -- only to read a single total off the result.
-- The per-user breakdown it built on the way was never looked at.
--
-- That cost grows with every AI call the workspace ever makes, on the most
-- frequently executed path in the product. This returns one row per currency.
--
-- SECURITY INVOKER so row-level security still applies: the caller sees only
-- the workspaces they can already read.

CREATE OR REPLACE FUNCTION public.billable_usage_totals(
  p_workspace_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  currency text,
  event_count bigint,
  quantity numeric,
  provider_cost numeric,
  customer_charge numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    -- Mirrors the JS default for a null currency, so totals agree with the
    -- detailed summary rather than splitting into a separate bucket.
    COALESCE(NULLIF(BTRIM(e.currency), ''), 'USD') AS currency,
    COUNT(*) AS event_count,
    COALESCE(SUM(e.quantity), 0) AS quantity,
    COALESCE(SUM(e.cost_snapshot), 0) AS provider_cost,
    COALESCE(SUM(e.customer_charge_snapshot), 0) AS customer_charge
  FROM public.usage_events e
  WHERE e.workspace_id = p_workspace_id
    AND e.created_at >= p_start
    AND e.created_at < p_end
    AND (p_user_id IS NULL OR e.user_id = p_user_id)
  GROUP BY 1
  ORDER BY 1;
$$;

-- Without this the aggregate still scans the workspace's whole usage history.
CREATE INDEX IF NOT EXISTS usage_events_workspace_created_idx
  ON public.usage_events (workspace_id, created_at);
