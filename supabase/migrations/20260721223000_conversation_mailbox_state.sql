alter table public.conversations
  add column if not exists deleted_at timestamptz;

create index if not exists conversations_workspace_active_last_message_idx
  on public.conversations (workspace_id, last_message_at desc)
  where deleted_at is null;

create index if not exists conversations_workspace_deleted_at_idx
  on public.conversations (workspace_id, deleted_at desc)
  where deleted_at is not null;

create or replace function public.restore_deleted_conversation_on_inbound_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.direction = 'inbound' and new.conversation_id is not null then
    update public.conversations
    set deleted_at = null,
        updated_at = now()
    where id = new.conversation_id
      and workspace_id = new.workspace_id
      and deleted_at is not null;
  end if;

  return new;
end;
$$;

drop trigger if exists restore_deleted_conversation_on_inbound_message
  on public.messages;

create trigger restore_deleted_conversation_on_inbound_message
after insert on public.messages
for each row
execute function public.restore_deleted_conversation_on_inbound_message();
