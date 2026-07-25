CREATE TABLE "workspace_payment_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_account_id" text,
  "status" text DEFAULT 'not_connected' NOT NULL,
  "charges_enabled" boolean DEFAULT false NOT NULL,
  "payouts_enabled" boolean DEFAULT false NOT NULL,
  "details_submitted" boolean DEFAULT false NOT NULL,
  "default_currency" text DEFAULT 'AUD' NOT NULL,
  "country_code" text,
  "onboarding_url" text,
  "onboarded_at" timestamptz,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_payment_accounts_status_check" CHECK (
    "status" IN ('not_connected', 'onboarding', 'active', 'restricted', 'disabled')
  )
);

CREATE UNIQUE INDEX "workspace_payment_accounts_workspace_provider_idx"
  ON public.workspace_payment_accounts(workspace_id, provider);

CREATE UNIQUE INDEX "workspace_payment_accounts_provider_account_idx"
  ON public.workspace_payment_accounts(provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

CREATE INDEX "workspace_payment_accounts_workspace_status_idx"
  ON public.workspace_payment_accounts(workspace_id, status);

CREATE TABLE "payment_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  "contact_id" uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  "conversation_id" uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  "quote_draft_id" uuid REFERENCES public.quote_drafts(id) ON DELETE SET NULL,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_account_id" text,
  "provider_checkout_session_id" text,
  "provider_payment_intent_id" text,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'AUD' NOT NULL,
  "description" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "payment_url" text,
  "due_at" timestamptz,
  "sent_at" timestamptz,
  "paid_at" timestamptz,
  "failed_at" timestamptz,
  "created_by" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "payment_requests_amount_positive_check" CHECK (amount_cents > 0),
  CONSTRAINT "payment_requests_currency_check" CHECK (char_length(currency) BETWEEN 3 AND 8),
  CONSTRAINT "payment_requests_status_check" CHECK (
    "status" IN ('draft', 'link_created', 'sent', 'paid', 'failed', 'cancelled', 'refunded', 'disputed')
  )
);

CREATE INDEX "payment_requests_workspace_status_idx"
  ON public.payment_requests(workspace_id, status, created_at DESC);

CREATE INDEX "payment_requests_contact_idx"
  ON public.payment_requests(contact_id, created_at DESC);

CREATE INDEX "payment_requests_checkout_session_idx"
  ON public.payment_requests(provider, provider_checkout_session_id)
  WHERE provider_checkout_session_id IS NOT NULL;

CREATE INDEX "payment_requests_payment_intent_idx"
  ON public.payment_requests(provider, provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;

CREATE TABLE "payment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  "payment_request_id" uuid REFERENCES public.payment_requests(id) ON DELETE SET NULL,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_event_id" text NOT NULL,
  "provider_event_type" text NOT NULL,
  "status" text DEFAULT 'processed' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "processed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "payment_events_status_check" CHECK (
    "status" IN ('processed', 'ignored', 'failed')
  )
);

CREATE UNIQUE INDEX "payment_events_provider_event_idx"
  ON public.payment_events(provider, provider_event_id);

CREATE INDEX "payment_events_workspace_created_idx"
  ON public.payment_events(workspace_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_payment_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_payment_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_events TO service_role;

ALTER TABLE public.workspace_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_payment_accounts_select"
  ON public.workspace_payment_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "workspace_payment_accounts_insert"
  ON public.workspace_payment_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "workspace_payment_accounts_update"
  ON public.workspace_payment_accounts
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "workspace_payment_accounts_delete"
  ON public.workspace_payment_accounts
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "payment_requests_select"
  ON public.payment_requests
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "payment_requests_insert"
  ON public.payment_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "payment_requests_update"
  ON public.payment_requests
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "payment_requests_delete"
  ON public.payment_requests
  FOR DELETE
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "payment_events_select"
  ON public.payment_events
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "payment_events_insert"
  ON public.payment_events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "payment_events_update"
  ON public.payment_events
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE TRIGGER "workspace_payment_accounts_updated_at"
  BEFORE UPDATE ON public.workspace_payment_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER "payment_requests_updated_at"
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
