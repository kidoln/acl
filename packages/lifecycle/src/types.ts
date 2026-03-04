import type { AuthzModelConfig, RelationEdge } from '@acl/shared-types';
import type { LifecycleEvent, ObjectSensitivity } from '@acl/shared-types';

export type LifecycleHandlerName =
  | 'revoke_direct_edges'
  | 'terminate_delegations'
  | 'recompute_inherited_permissions';

export interface LifecycleObjectSnapshot {
  object_id: string;
  owner_ref: string;
  sensitivity: ObjectSensitivity;
}

export interface SubjectRemovedOptions {
  fallback_owner?: string;
}

export interface ExecuteSubjectRemovedInput {
  model: AuthzModelConfig;
  event: LifecycleEvent & {
    target: string;
  };
  object_snapshots?: LifecycleObjectSnapshot[];
  options?: SubjectRemovedOptions;
}

export interface SubjectRemovedHandlerStatus {
  configured: LifecycleHandlerName[];
  missing: LifecycleHandlerName[];
  default_applied: boolean;
}

export interface RecomputeSummary {
  mode: 'full_recompute_required';
  impacted_subject_ids: string[];
  impacted_object_ids: string[];
}

export interface OwnershipReassigned {
  object_id: string;
  from_owner: string;
  to_owner: string;
}

export interface TakeoverQueueItem {
  object_id: string;
  sensitivity: ObjectSensitivity;
  reason: string;
}

export interface LifecycleImpactReport {
  affected_subject_count: number;
  affected_object_count: number;
  revoked_relation_count: number;
  terminated_delegation_count: number;
  reassigned_object_count: number;
  takeover_queue_count: number;
}

export interface SubjectRemovedExecutionResult {
  event: LifecycleEvent;
  handler_status: SubjectRemovedHandlerStatus;
  revoked_edges: RelationEdge[];
  terminated_delegations: RelationEdge[];
  recompute_summary: RecomputeSummary;
  ownership_reassigned: OwnershipReassigned[];
  takeover_queue: TakeoverQueueItem[];
  relation_snapshot: {
    before: {
      subject_relations: number;
      object_relations: number;
      subject_object_relations: number;
    };
    after: {
      subject_relations: number;
      object_relations: number;
      subject_object_relations: number;
    };
  };
  audit: {
    freeze_history: true;
    impact_report: LifecycleImpactReport;
  };
}
