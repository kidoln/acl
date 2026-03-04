import { randomUUID } from 'node:crypto';

import { InMemoryPersistence } from './memory';
import { PostgresPersistence } from './postgres';
import type { AclPersistence } from './types';

type PersistenceDriver = 'memory' | 'postgres';

export interface PersistenceBootstrapResult {
  persistence: AclPersistence;
  driver: PersistenceDriver;
}

function normalizeDriver(input: string | undefined): PersistenceDriver | undefined {
  const value = input?.trim().toLowerCase();
  if (!value) {
    return undefined;
  }

  if (value === 'postgres' || value === 'postgresql' || value === 'pg') {
    return 'postgres';
  }

  if (value === 'memory' || value === 'mem') {
    return 'memory';
  }

  throw new Error(
    `unsupported ACL_PERSISTENCE_DRIVER=${input}; expected one of: postgres, memory`,
  );
}

export function createPersistenceFromEnv(env: NodeJS.ProcessEnv): PersistenceBootstrapResult {
  const driver = normalizeDriver(env.ACL_PERSISTENCE_DRIVER);
  const connectionString = env.ACL_POSTGRES_DSN?.trim();

  const usePostgres = driver === 'postgres' || (driver === undefined && Boolean(connectionString));

  if (usePostgres) {
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
