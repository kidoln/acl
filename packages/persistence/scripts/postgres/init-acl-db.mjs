#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, 'migrations');

function quoteIdent(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function ensureSafeIdentifier(name, field) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`${field}="${name}" is invalid, only [a-zA-Z_][a-zA-Z0-9_]* is allowed`);
  }
  return name;
}

function toPositiveInt(input, fallback) {
  const parsed = Number(input ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid port: ${input}`);
  }
  return parsed;
}

function listMigrationFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function ensureRole(adminClient, appUser, appPassword) {
  const exists = await adminClient.query('select 1 from pg_roles where rolname = $1', [appUser]);

  if (exists.rowCount === 0) {
    await adminClient.query(
      `create role ${quoteIdent(appUser)} login password ${quoteLiteral(appPassword)}`,
    );
    console.log(`[db:init] created role: ${appUser}`);
  } else {
    await adminClient.query(
      `alter role ${quoteIdent(appUser)} with login password ${quoteLiteral(appPassword)}`,
    );
    console.log(`[db:init] role already exists, password refreshed: ${appUser}`);
  }
}

async function ensureDatabase(adminClient, dbName, appUser) {
  const exists = await adminClient.query('select 1 from pg_database where datname = $1', [dbName]);

  if (exists.rowCount === 0) {
    await adminClient.query(
      `create database ${quoteIdent(dbName)} owner ${quoteIdent(appUser)} encoding 'UTF8' template template0`,
    );
    console.log(`[db:init] created database: ${dbName}`);
  } else {
    console.log(`[db:init] database already exists: ${dbName}`);
  }

  await adminClient.query(`alter database ${quoteIdent(dbName)} owner to ${quoteIdent(appUser)}`);
  await adminClient.query(`grant connect on database ${quoteIdent(dbName)} to ${quoteIdent(appUser)}`);
}

async function ensureMigrationTable(dbClient) {
  await dbClient.query(`
    create table if not exists acl_schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function applyMigrations(dbClient, files) {
  for (const filename of files) {
    const version = filename.replace(/\.sql$/, '');
    const filepath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(filepath, 'utf8');
    const checksum = sha256(sql);

    const existing = await dbClient.query(
      'select version, checksum from acl_schema_migrations where version = $1',
      [version],
    );

    if (existing.rowCount > 0) {
      const oldChecksum = existing.rows[0].checksum;
      if (oldChecksum !== checksum) {
        throw new Error(
          `migration checksum mismatch: version=${version}, expected=${oldChecksum}, current=${checksum}`,
        );
      }

      console.log(`[db:init] skip migration (already applied): ${version}`);
      continue;
    }

    await dbClient.query('begin');
    try {
      await dbClient.query(sql);
      await dbClient.query(
        'insert into acl_schema_migrations (version, checksum) values ($1, $2)',
        [version, checksum],
      );
      await dbClient.query('commit');
      console.log(`[db:init] applied migration: ${version}`);
    } catch (error) {
      await dbClient.query('rollback');
      throw error;
    }
  }
}

async function grantTablePrivileges(dbClient, adminUser, appUser) {
  await dbClient.query(`grant usage on schema public to ${quoteIdent(appUser)}`);
  await dbClient.query(`grant select, insert, update, delete on all tables in schema public to ${quoteIdent(appUser)}`);
  await dbClient.query(
    `alter default privileges for role ${quoteIdent(adminUser)} in schema public grant select, insert, update, delete on tables to ${quoteIdent(appUser)}`,
  );
}

async function main() {
  const host = process.env.ACL_DB_HOST ?? '127.0.0.1';
  const port = toPositiveInt(process.env.ACL_DB_PORT, 5432);
  const adminUser = ensureSafeIdentifier(process.env.ACL_DB_ADMIN_USER ?? 'dbuser', 'ACL_DB_ADMIN_USER');
  const adminPassword = process.env.ACL_DB_ADMIN_PASSWORD ?? '123456';
  const adminDatabase = ensureSafeIdentifier(
    process.env.ACL_DB_ADMIN_DATABASE ?? 'postgres',
    'ACL_DB_ADMIN_DATABASE',
  );

  const aclDatabase = ensureSafeIdentifier(process.env.ACL_DB_NAME ?? 'acl_core', 'ACL_DB_NAME');
  const appUser = ensureSafeIdentifier(process.env.ACL_DB_APP_USER ?? 'acl_app', 'ACL_DB_APP_USER');
  const appPassword = process.env.ACL_DB_APP_PASSWORD ?? 'acl_app_change_me';

  const adminConfig = {
    host,
    port,
    user: adminUser,
    password: adminPassword,
    database: adminDatabase,
  };

  const migrationFiles = listMigrationFiles(migrationsDir);
  if (migrationFiles.length === 0) {
    throw new Error(`no migrations found in ${migrationsDir}`);
  }

  console.log(`[db:init] target host=${host} port=${port}`);
  console.log(`[db:init] admin db=${adminDatabase} admin user=${adminUser}`);
  console.log(`[db:init] target acl database=${aclDatabase} app user=${appUser}`);

  const adminClient = new Client(adminConfig);
  await adminClient.connect();

  try {
    await ensureRole(adminClient, appUser, appPassword);
    await ensureDatabase(adminClient, aclDatabase, appUser);
  } finally {
    await adminClient.end();
  }

  const aclClient = new Client({ ...adminConfig, database: aclDatabase });
  await aclClient.connect();

  try {
    await ensureMigrationTable(aclClient);
    await applyMigrations(aclClient, migrationFiles);
    await grantTablePrivileges(aclClient, adminUser, appUser);
  } finally {
    await aclClient.end();
  }

  const encodedUser = encodeURIComponent(appUser);
  const encodedPassword = encodeURIComponent(appPassword);
  const dsn = `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${aclDatabase}`;

  console.log('[db:init] done');
  console.log(`[db:init] ACL_POSTGRES_DSN=${dsn}`);
  console.log('[db:init] suggested env: ACL_PERSISTENCE_DRIVER=postgres');
}

main().catch((error) => {
  console.error('[db:init] failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
