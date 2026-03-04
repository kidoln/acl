create table if not exists acl_validation_records (
  id text primary key,
  model_id text not null,
  created_at timestamptz not null,
  payload jsonb not null,
  constraint ck_acl_validation_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_acl_validation_records_model_created_at
  on acl_validation_records (model_id, created_at desc);

create table if not exists acl_gate_reports (
  id text primary key,
  profile text not null,
  final_result text not null,
  created_at timestamptz not null,
  payload jsonb not null,
  constraint ck_acl_gate_profile
    check (profile in ('baseline', 'strict_compliance')),
  constraint ck_acl_gate_final_result
    check (final_result in ('blocked', 'review_required', 'passed', 'passed_with_ticket')),
  constraint ck_acl_gate_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_acl_gate_reports_profile_created_at
  on acl_gate_reports (profile, created_at desc);

create table if not exists acl_decision_records (
  id text primary key,
  created_at timestamptz not null,
  payload jsonb not null,
  traces jsonb not null,
  constraint ck_acl_decision_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint ck_acl_decision_traces_array check (jsonb_typeof(traces) = 'array')
);

create index if not exists idx_acl_decision_records_created_at
  on acl_decision_records (created_at desc);
