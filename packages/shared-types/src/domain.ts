export type SubjectState = 'active' | 'disabled' | 'removed';

export type ObjectSensitivity = 'low' | 'normal' | 'high';

export interface SubjectNode {
  id: string;
  type: string;
  state: SubjectState;
  labels?: string[];
}

export interface ObjectNode {
  id: string;
  type: string;
  sensitivity: ObjectSensitivity;
  owner_ref: string;
  labels?: string[];
}

export interface ValidityWindow {
  start: string;
  end: string;
}

export interface RelationEdge {
  from: string;
  to: string;
  relation_type: string;
  scope?: string;
  validity?: ValidityWindow;
  source?: string;
}

export interface ActionAtom {
  action_id: string;
  action_domain: string;
  risk_level: 'low' | 'medium' | 'high';
}

export interface LifecycleEvent {
  event_type: string;
  target: string;
  occurred_at: string;
  operator: string;
}
