create table if not exists acl_publish_requests (
  id text primary key,
  profile text not null,
  status text not null,
  final_result text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  payload jsonb not null,
  constraint ck_acl_publish_profile
    check (profile in ('baseline', 'strict_compliance')),
  constraint ck_acl_publish_status
    check (status in ('blocked', 'review_required', 'approved', 'rejected', 'published')),
  constraint ck_acl_publish_final_result
    check (final_result in ('blocked', 'review_required', 'passed', 'passed_with_ticket')),
  constraint ck_acl_publish_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_acl_publish_requests_status_updated_at
  on acl_publish_requests (status, updated_at desc);
