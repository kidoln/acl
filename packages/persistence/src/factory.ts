import { randomUUID } from 'node:crypto';

import { InMemoryPersistence } from './memory';
import { PostgresPersistence } from './postgres';
import type { AclPersistence } from './types';

export interface PersistenceBootstrapResult {
  persistence: AclPersistence;
  driver: 'memory' | 'postgres';
}

export function createPersistenceFromEnv(env: NodeJS.ProcessEnv): PersistenceBootstrapResult {
  const driver = env.ACL_PERSISTENCE_DRIVER;

  if (driver === 'postgres') {
    const connectionString = env.ACL_POSTGRES_DSN;
    if (!connectionString) {
      throw new Error('ACL_POSTGRES_DSN is required when ACL_PERSISTENCE_DRIVER=postgres');
    }

    return {
      persistence: new PostgresPersistence({ connectionString }),
      driver: 'postgres',
    };
  }

  return {
    persistence: new InMemoryPersistence(),
    driver: 'memory',
  };
}

export function nextValidationId(): string {
  return `val_${randomUUID()}`;
}

export function nextDecisionId(): string {
  return `dec_${randomUUID()}`;
}

export function nextLifecycleId(): string {
  return `lfc_${randomUUID()}`;
}
