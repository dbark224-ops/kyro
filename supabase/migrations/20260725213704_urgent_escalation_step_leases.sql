-- Urgent escalation steps had no lease.
--
-- claim_due_urgent_escalation_steps set status = 'processing' with no expiry and
-- no reclaim path, and only ever selected status = 'pending'. The worker's own
-- catch block handles a delivery that fails, but if the process dies between the
-- claim and that catch -- function timeout, crash, deploy mid-flight -- the row
-- stays 'processing' forever. Nothing retries it and nothing alerts. This is the
-- 2am emergency path, so a stranded step means nobody is called.
--
-- claim_background_jobs already does this correctly; this brings escalation into
-- line with it.

ALTER TABLE public.urgent_escalation_steps
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS urgent_escalation_steps_lease_expires_at_idx
  ON public.urgent_escalation_steps (lease_expires_at)
  WHERE status = 'processing';

-- Signature is unchanged so the existing worker call and GRANT still apply.
CREATE OR REPLACE FUNCTION public.claim_due_urgent_escalation_steps(
  p_limit integer DEFAULT 50
)
RETURNS SETOF public.urgent_escalation_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Comfortably above the worker's 60s maxDuration. The lease must outlast the
  -- longest possible run, otherwise a step still being delivered could be
  -- reclaimed and the contact would be called or texted twice about the same
  -- emergency. Recovering a stranded step within 5 minutes is the right trade
  -- against that.
  lease_seconds constant integer := 300;
BEGIN
  -- A step whose worker died and which has no attempts left becomes 'failed', so
  -- the incident can finish and an operator sees it, rather than hanging in
  -- 'processing' indefinitely.
  UPDATE public.urgent_escalation_steps
  SET status = 'failed',
      error = coalesce(
        error,
        'Escalation worker stopped before completing this step.'
      ),
      lease_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE status = 'processing'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at < clock_timestamp()
    AND attempt_count >= max_attempts;

  RETURN QUERY
  UPDATE public.urgent_escalation_steps s
  SET status = 'processing',
      attempt_count = s.attempt_count + 1,
      error = NULL,
      lease_expires_at = clock_timestamp()
        + make_interval(secs => lease_seconds),
      updated_at = clock_timestamp()
  WHERE s.id IN (
    SELECT candidate.id
    FROM public.urgent_escalation_steps candidate
    JOIN public.urgent_escalation_incidents incident
      ON incident.id = candidate.incident_id
    WHERE incident.status = 'open'
      AND (
        -- Normal due work.
        (
          candidate.status = 'pending'
          AND candidate.due_at <= clock_timestamp()
        )
        -- Reclaim a step abandoned mid-flight, while attempts remain.
        OR (
          candidate.status = 'processing'
          AND candidate.lease_expires_at IS NOT NULL
          AND candidate.lease_expires_at < clock_timestamp()
          AND candidate.attempt_count < candidate.max_attempts
        )
      )
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
