-- Avoid colliding with PostgreSQL's CURRENT_TIME keyword in the rate limiter.

create or replace function public.consume_api_rate_limit(
  p_route text,
  p_key_hash text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
  request_timestamp timestamptz := clock_timestamp();
  window_start timestamptz;
  window_expiry timestamptz;
begin
  if p_route is null or btrim(p_route) = '' or
     p_key_hash is null or btrim(p_key_hash) = '' or
     p_window_seconds < 1 or p_max_requests < 1 then
    raise exception 'Invalid rate-limit input';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from request_timestamp) / p_window_seconds) * p_window_seconds
  );
  window_expiry := window_start + make_interval(secs => p_window_seconds);

  insert into public.api_rate_limit_buckets (
    route,
    key_hash,
    window_started_at,
    request_count,
    expires_at,
    updated_at
  ) values (
    p_route,
    p_key_hash,
    window_start,
    1,
    window_expiry,
    request_timestamp
  )
  on conflict (route, key_hash, window_started_at)
  do update set
    request_count = public.api_rate_limit_buckets.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into current_count;

  delete from public.api_rate_limit_buckets
  where expires_at < request_timestamp - interval '1 day';

  return query select
    current_count <= p_max_requests,
    greatest(p_max_requests - current_count, 0),
    greatest(ceil(extract(epoch from (window_expiry - request_timestamp)))::integer, 1);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer)
  to service_role;
