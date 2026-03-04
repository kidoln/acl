create table if not exists acl_lifecycle_reports (
  id text primary key,
  event_type text not null,
  target text not null,
  created_at timestamptz not null,
  payload jsonb not null,
  constraint ck_acl_lifecycle_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_acl_lifecycle_reports_event_target_created_at
  on acl_lifecycle_reports (event_type, target, created_at desc);
