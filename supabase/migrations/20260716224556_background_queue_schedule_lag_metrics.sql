drop function public.background_job_queue_metrics();

create function public.background_job_queue_metrics()
returns table(
  job_type text,
  ready_count bigint,
  processing_count bigint,
  failed_count bigint,
  expired_lease_count bigint,
  oldest_ready_at timestamptz,
  oldest_ready_age_seconds bigint,
  overdue_schedule_count bigint,
  oldest_schedule_at timestamptz,
  oldest_schedule_age_seconds bigint
)
language sql
set search_path = pg_catalog, public
as $$
  with job_metrics as (
    select
      job.job_type,
      count(*) filter (
        where job.status in ('pending', 'retry') and job.due_at <= now()
      ) as ready_count,
      count(*) filter (where job.status = 'processing') as processing_count,
      count(*) filter (where job.status = 'failed') as failed_count,
      count(*) filter (
        where job.status = 'processing' and job.lease_expires_at < now()
      ) as expired_lease_count,
      min(job.due_at) filter (
        where job.status in ('pending', 'retry') and job.due_at <= now()
      ) as oldest_ready_at
    from public.background_jobs job
    group by job.job_type
  ),
  schedule_metrics as (
    select
      schedule.job_type,
      count(*) filter (
        where schedule.enabled = true and schedule.next_run_at <= now()
      ) as overdue_schedule_count,
      min(schedule.next_run_at) filter (
        where schedule.enabled = true and schedule.next_run_at <= now()
      ) as oldest_schedule_at
    from public.background_job_schedules schedule
    group by schedule.job_type
  ),
  job_types as (
    select job_type from job_metrics
    union
    select job_type from schedule_metrics
  )
  select
    job_types.job_type,
    coalesce(job_metrics.ready_count, 0)::bigint,
    coalesce(job_metrics.processing_count, 0)::bigint,
    coalesce(job_metrics.failed_count, 0)::bigint,
    coalesce(job_metrics.expired_lease_count, 0)::bigint,
    job_metrics.oldest_ready_at,
    coalesce(
      extract(epoch from (now() - job_metrics.oldest_ready_at))::bigint,
      0
    ),
    coalesce(schedule_metrics.overdue_schedule_count, 0)::bigint,
    schedule_metrics.oldest_schedule_at,
    coalesce(
      extract(epoch from (now() - schedule_metrics.oldest_schedule_at))::bigint,
      0
    )
  from job_types
  left join job_metrics using (job_type)
  left join schedule_metrics using (job_type)
  order by job_types.job_type;
$$;

revoke all on function public.background_job_queue_metrics() from public, anon, authenticated;
grant execute on function public.background_job_queue_metrics() to service_role;
