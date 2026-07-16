-- Durable signup recovery, billing access/dunning, and urgent escalation state.

CREATE TABLE public.signup_bootstrap_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL,
  normalized_phone text NOT NULL,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'reserved',
  stage text NOT NULL DEFAULT 'identity_reserved',
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signup_bootstrap_records_status_check CHECK (
    status IN ('reserved', 'auth_created', 'workspace_created', 'billing_pending', 'complete', 'failed')
  )
);

CREATE UNIQUE INDEX signup_bootstrap_records_email_idx
  ON public.signup_bootstrap_records (normalized_email);
CREATE UNIQUE INDEX signup_bootstrap_records_phone_idx
  ON public.signup_bootstrap_records (normalized_phone);
CREATE UNIQUE INDEX signup_bootstrap_records_auth_user_idx
  ON public.signup_bootstrap_records (auth_user_id)
  WHERE auth_user_id IS NOT NULL;
CREATE INDEX signup_bootstrap_records_status_updated_idx
  ON public.signup_bootstrap_records (status, updated_at DESC);

CREATE TRIGGER set_signup_bootstrap_records_updated_at
  BEFORE UPDATE ON public.signup_bootstrap_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.signup_bootstrap_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.signup_bootstrap_records FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.signup_bootstrap_records TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_signup_bootstrap(
  p_email text,
  p_phone text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  record_id uuid,
  conflict text,
  record_status text,
  existing_auth_user_id uuid,
  existing_workspace_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  clean_email text := lower(btrim(coalesce(p_email, '')));
  clean_phone text := btrim(coalesce(p_phone, ''));
  phone_digits text;
  existing_record public.signup_bootstrap_records%ROWTYPE;
  matched_auth_user_id uuid;
  matched_auth_email boolean := false;
  matched_auth_phone boolean := false;
BEGIN
  phone_digits := regexp_replace(clean_phone, '[^0-9]', '', 'g');

  IF clean_email = '' OR clean_phone = '' OR phone_digits = '' THEN
    RAISE EXCEPTION 'A normalized email and phone number are required';
  END IF;

  SELECT s.* INTO existing_record
  FROM public.signup_bootstrap_records s
  WHERE s.normalized_email = clean_email
     OR s.normalized_phone = clean_phone
  ORDER BY s.created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF existing_record.normalized_email <> clean_email THEN
      RETURN QUERY SELECT existing_record.id, 'phone'::text, existing_record.status,
        existing_record.auth_user_id, existing_record.workspace_id;
      RETURN;
    END IF;

    IF existing_record.normalized_phone <> clean_phone THEN
      RETURN QUERY SELECT existing_record.id, 'email'::text, existing_record.status,
        existing_record.auth_user_id, existing_record.workspace_id;
      RETURN;
    END IF;

    IF existing_record.status = 'complete' OR existing_record.auth_user_id IS NOT NULL THEN
      RETURN QUERY SELECT existing_record.id, 'recoverable'::text, existing_record.status,
        existing_record.auth_user_id, existing_record.workspace_id;
      RETURN;
    END IF;

    SELECT u.id,
      lower(coalesce(u.email, '')) = clean_email,
      regexp_replace(
        coalesce(
          u.phone,
          u.raw_user_meta_data ->> 'kyroMobileNumber',
          u.raw_user_meta_data ->> 'phone',
          u.raw_user_meta_data ->> 'mobileNumber',
          u.raw_user_meta_data ->> 'mobile',
          u.raw_user_meta_data ->> 'publicPhoneNumber',
          ''
        ),
        '[^0-9]',
        '',
        'g'
      ) = phone_digits
    INTO matched_auth_user_id, matched_auth_email, matched_auth_phone
    FROM auth.users u
    WHERE lower(coalesce(u.email, '')) = clean_email
       OR regexp_replace(
         coalesce(
           u.phone,
           u.raw_user_meta_data ->> 'kyroMobileNumber',
           u.raw_user_meta_data ->> 'phone',
           u.raw_user_meta_data ->> 'mobileNumber',
           u.raw_user_meta_data ->> 'mobile',
           u.raw_user_meta_data ->> 'publicPhoneNumber',
           ''
         ),
         '[^0-9]',
         '',
         'g'
       ) = phone_digits
    ORDER BY u.created_at
    LIMIT 1;

    IF matched_auth_user_id IS NOT NULL THEN
      UPDATE public.signup_bootstrap_records
      SET auth_user_id = matched_auth_user_id,
          attempts = attempts + 1,
          last_error = NULL,
          payload = coalesce(p_payload, '{}'::jsonb),
          stage = 'auth_created',
          status = 'auth_created'
      WHERE id = existing_record.id;

      RETURN QUERY SELECT existing_record.id,
        CASE WHEN matched_auth_email THEN 'recoverable' ELSE 'phone' END,
        'auth_created'::text,
        matched_auth_user_id,
        existing_record.workspace_id;
      RETURN;
    END IF;

    UPDATE public.signup_bootstrap_records
    SET attempts = attempts + 1,
        last_error = NULL,
        payload = coalesce(p_payload, '{}'::jsonb),
        stage = 'identity_reserved',
        status = 'reserved'
    WHERE id = existing_record.id;

    RETURN QUERY SELECT existing_record.id, NULL::text, 'reserved'::text,
      NULL::uuid, existing_record.workspace_id;
    RETURN;
  END IF;

  SELECT u.id,
    lower(coalesce(u.email, '')) = clean_email,
    regexp_replace(
      coalesce(
        u.phone,
        u.raw_user_meta_data ->> 'kyroMobileNumber',
        u.raw_user_meta_data ->> 'phone',
        u.raw_user_meta_data ->> 'mobileNumber',
        u.raw_user_meta_data ->> 'mobile',
        u.raw_user_meta_data ->> 'publicPhoneNumber',
        ''
      ),
      '[^0-9]',
      '',
      'g'
    ) = phone_digits
  INTO matched_auth_user_id, matched_auth_email, matched_auth_phone
  FROM auth.users u
  WHERE lower(coalesce(u.email, '')) = clean_email
     OR regexp_replace(
       coalesce(
         u.phone,
         u.raw_user_meta_data ->> 'kyroMobileNumber',
         u.raw_user_meta_data ->> 'phone',
         u.raw_user_meta_data ->> 'mobileNumber',
         u.raw_user_meta_data ->> 'mobile',
         u.raw_user_meta_data ->> 'publicPhoneNumber',
         ''
       ),
       '[^0-9]',
       '',
       'g'
     ) = phone_digits
  ORDER BY u.created_at
  LIMIT 1;

  IF matched_auth_user_id IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid,
      CASE WHEN matched_auth_email THEN 'email' ELSE 'phone' END,
      'auth_created'::text,
      matched_auth_user_id,
      NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.signup_bootstrap_records (
    normalized_email,
    normalized_phone,
    payload
  ) VALUES (
    clean_email,
    clean_phone,
    coalesce(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO record_id;

  conflict := NULL;
  record_status := 'reserved';
  existing_auth_user_id := NULL;
  existing_workspace_id := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_signup_bootstrap(text, text, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_signup_bootstrap(text, text, jsonb)
  TO service_role;

CREATE TABLE public.workspace_billing_access (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  reason text,
  trial_ends_at timestamptz,
  grace_started_at timestamptz,
  grace_ends_at timestamptz,
  restricted_at timestamptz,
  recovered_at timestamptz,
  latest_invoice_id uuid REFERENCES public.kyro_invoices(id) ON DELETE SET NULL,
  latest_failure_at timestamptz,
  dunning_stage integer NOT NULL DEFAULT 0 CHECK (dunning_stage >= 0),
  next_dunning_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_billing_access_status_check CHECK (
    status IN ('trial', 'active', 'grace', 'restricted', 'cancelled')
  )
);

CREATE INDEX workspace_billing_access_status_due_idx
  ON public.workspace_billing_access (status, next_dunning_at);

CREATE TRIGGER set_workspace_billing_access_updated_at
  BEFORE UPDATE ON public.workspace_billing_access
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.workspace_billing_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workspace_billing_access FROM public, anon;
GRANT SELECT ON TABLE public.workspace_billing_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_billing_access TO service_role;

CREATE POLICY workspace_billing_access_select_member
  ON public.workspace_billing_access
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE TABLE public.billing_dunning_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.kyro_invoices(id) ON DELETE SET NULL,
  stage text NOT NULL,
  dedupe_key text NOT NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error text,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_dunning_deliveries_status_check CHECK (
    status IN ('pending', 'sent', 'failed', 'skipped')
  )
);

CREATE UNIQUE INDEX billing_dunning_deliveries_dedupe_idx
  ON public.billing_dunning_deliveries (dedupe_key);
CREATE INDEX billing_dunning_deliveries_workspace_created_idx
  ON public.billing_dunning_deliveries (workspace_id, created_at DESC);

CREATE TRIGGER set_billing_dunning_deliveries_updated_at
  BEFORE UPDATE ON public.billing_dunning_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.billing_dunning_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_dunning_deliveries FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.billing_dunning_deliveries TO service_role;

CREATE TABLE public.urgent_escalation_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text,
  source_key text NOT NULL,
  trigger_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  requires_acknowledgement boolean NOT NULL DEFAULT true,
  acknowledgement_token uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT urgent_escalation_incidents_status_check CHECK (
    status IN ('open', 'acknowledged', 'resolved', 'cancelled', 'exhausted')
  )
);

CREATE UNIQUE INDEX urgent_escalation_incidents_source_key_idx
  ON public.urgent_escalation_incidents (workspace_id, source_key);
CREATE UNIQUE INDEX urgent_escalation_incidents_ack_token_idx
  ON public.urgent_escalation_incidents (acknowledgement_token);
CREATE INDEX urgent_escalation_incidents_open_idx
  ON public.urgent_escalation_incidents (workspace_id, status, occurred_at DESC);

CREATE TRIGGER set_urgent_escalation_incidents_updated_at
  BEFORE UPDATE ON public.urgent_escalation_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.urgent_escalation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.urgent_escalation_incidents(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  policy_step_id text NOT NULL,
  channel text NOT NULL,
  contact_id text,
  contact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  provider_message_id text,
  provider_request_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT urgent_escalation_steps_channel_check CHECK (
    channel IN ('email', 'app_notification', 'sms', 'phone')
  ),
  CONSTRAINT urgent_escalation_steps_status_check CHECK (
    status IN ('pending', 'processing', 'sent', 'failed', 'skipped', 'cancelled')
  )
);

CREATE UNIQUE INDEX urgent_escalation_steps_incident_position_idx
  ON public.urgent_escalation_steps (incident_id, position);
CREATE INDEX urgent_escalation_steps_due_idx
  ON public.urgent_escalation_steps (status, due_at);

CREATE TRIGGER set_urgent_escalation_steps_updated_at
  BEFORE UPDATE ON public.urgent_escalation_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.urgent_escalation_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.urgent_escalation_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.urgent_escalation_incidents FROM public, anon;
REVOKE ALL ON TABLE public.urgent_escalation_steps FROM public, anon;
GRANT SELECT ON TABLE public.urgent_escalation_incidents TO authenticated;
GRANT SELECT ON TABLE public.urgent_escalation_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.urgent_escalation_incidents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.urgent_escalation_steps TO service_role;

CREATE POLICY urgent_escalation_incidents_select_member
  ON public.urgent_escalation_incidents
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY urgent_escalation_steps_select_member
  ON public.urgent_escalation_steps
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION public.claim_due_urgent_escalation_steps(
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.urgent_escalation_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.urgent_escalation_steps s
  SET status = 'processing',
      attempt_count = s.attempt_count + 1,
      error = NULL,
      updated_at = clock_timestamp()
  WHERE s.id IN (
    SELECT candidate.id
    FROM public.urgent_escalation_steps candidate
    JOIN public.urgent_escalation_incidents incident
      ON incident.id = candidate.incident_id
    WHERE candidate.status = 'pending'
      AND candidate.due_at <= clock_timestamp()
      AND incident.status = 'open'
    ORDER BY candidate.due_at, candidate.position
    FOR UPDATE OF candidate SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
  )
  RETURNING s.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_urgent_escalation_steps(integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_urgent_escalation_steps(integer)
  TO service_role;
