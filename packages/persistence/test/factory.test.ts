import { describe, expect, it } from 'vitest';

import { createPersistenceFromEnv } from '../src/factory';
import { InMemoryPersistence } from '../src/memory';
import { PostgresPersistence } from '../src/postgres';

describe('persistence factory', () => {
  it('falls back to memory when no driver and no dsn', () => {
    const bootstrap = createPersistenceFromEnv({});
    expect(bootstrap.driver).toBe('memory');
    expect(bootstrap.persistence).toBeInstanceOf(InMemoryPersistence);
  });

  it('uses postgres when explicit driver is postgres', () => {
    const bootstrap = createPersistenceFromEnv({
      ACL_PERSISTENCE_DRIVER: 'postgres',
      ACL_POSTGRES_DSN: 'postgresql://user:pwd@127.0.0.1:5432/acl_core',
    });

    expect(bootstrap.driver).toBe('postgres');
    expect(bootstrap.persistence).toBeInstanceOf(PostgresPersistence);
  });

  it('uses postgres automatically when dsn exists', () => {
    const bootstrap = createPersistenceFromEnv({
      ACL_POSTGRES_DSN: 'postgresql://user:pwd@127.0.0.1:5432/acl_core',
    });

    expect(bootstrap.driver).toBe('postgres');
    expect(bootstrap.persistence).toBeInstanceOf(PostgresPersistence);
  });

  it('keeps memory when explicit driver is memory even if dsn exists', () => {
    const bootstrap = createPersistenceFromEnv({
      ACL_PERSISTENCE_DRIVER: 'memory',
      ACL_POSTGRES_DSN: 'postgresql://user:pwd@127.0.0.1:5432/acl_core',
    });

    expect(bootstrap.driver).toBe('memory');
    expect(bootstrap.persistence).toBeInstanceOf(InMemoryPersistence);
  });

  it('throws when postgres selected without dsn', () => {
    expect(() =>
      createPersistenceFromEnv({
        ACL_PERSISTENCE_DRIVER: 'postgres',
      }),
    ).toThrow(/ACL_POSTGRES_DSN is required/);
  });

  it('throws on unsupported driver value', () => {
    expect(() =>
      createPersistenceFromEnv({
        ACL_PERSISTENCE_DRIVER: 'mysql',
      }),
    ).toThrow(/unsupported ACL_PERSISTENCE_DRIVER/);
  });
});
