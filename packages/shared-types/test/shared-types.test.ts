import { describe, expect, it } from 'vitest';

import { minimalDraftModel } from '../src/examples';

describe('shared types fixtures', () => {
  it('should keep minimal model with required root blocks', () => {
    expect(minimalDraftModel.model_meta.model_id).toBe('tenant_a_authz_v1');
    expect(minimalDraftModel.policies.rules.length).toBeGreaterThan(0);
    expect(minimalDraftModel.lifecycle.event_rules[0]?.event_type).toBe('subject_removed');
  });
});
