import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

let app: FastifyInstance;
let previousPersistenceDriver: string | undefined;

async function evaluateDecisionOnce(suffix: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/decisions:evaluate',
    payload: {
      model: minimalDraftModel,
      input: {
        action: 'read',
        subject: {
          id: `user:${suffix}`,
          type: 'user',
        },
        object: {
          id: `kb:${suffix}`,
          type: 'kb',
          sensitivity: 'normal',
        },
        context: {
          same_department: suffix === 'allow',
        },
      },
      options: {
        strict_validation: false,
        available_obligation_executors: ['audit_write'],
        relation_inference: {
          enabled: false,
          namespace: 'tenant_a.crm',
        },
      },
    },
  });

  expect(response.statusCode).toBe(200);
  return response.json() as {
    decision_id: string;
  };
}

describe('decision api integration', () => {
  beforeEach(async () => {
    previousPersistenceDriver = process.env.ACL_PERSISTENCE_DRIVER;
    process.env.ACL_PERSISTENCE_DRIVER = 'memory';
    vi.resetModules();
    const moduleRef = await import('../src/main');
    app = moduleRef.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (previousPersistenceDriver === undefined) {
      delete process.env.ACL_PERSISTENCE_DRIVER;
    } else {
      process.env.ACL_PERSISTENCE_DRIVER = previousPersistenceDriver;
    }
  });

  it('lists persisted decision ids in reverse chronological order', async () => {
    const first = await evaluateDecisionOnce('first');
    const second = await evaluateDecisionOnce('second');

    const response = await app.inject({
      method: 'GET',
      url: '/decisions?limit=20&offset=0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ decision_id: string; created_at: string }>;
      total_count: number;
      has_more: boolean;
      limit: number;
      offset: number;
    };

    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
    expect(body.total_count).toBeGreaterThanOrEqual(2);
    expect(body.items[0]?.decision_id).toBe(second.decision_id);
    expect(body.items.some((item) => item.decision_id === first.decision_id)).toBe(true);
    expect(body.items.every((item) => typeof item.created_at === 'string')).toBe(true);
  });
});
