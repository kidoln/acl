import fs from "node:fs";
import path from "node:path";

interface SetupFixtureDisplayOverride {
  order: number;
  label: string;
}

export interface ControlSetupFixture {
  route?: {
    tenant_id: string;
    environment: string;
  };
  namespace_prefix?: string;
  objects: Array<{
    object_id: string;
    object_type: string;
    sensitivity?: string;
    owner_ref?: string;
    labels?: string[];
  }>;
  relation_events: Array<{
    from: string;
    to: string;
    relation_type: string;
    operation: "upsert" | "delete";
    scope?: string;
    source?: string;
  }>;
}

export interface SetupFixtureOption {
  id: string;
  file_name: string;
  label: string;
  description: string;
}

export interface LoadedSetupFixture {
  id: string;
  file_name: string;
  fixture: ControlSetupFixture;
}

const SETUP_FIXTURE_DISPLAY_OVERRIDES: Record<
  string,
  SetupFixtureDisplayOverride
> = {
  "same-company-derived.setup.json": {
    order: 1,
    label: "样例1：同公司派生关系 setup",
  },
  "virtual-team-department-scope.setup.json": {
    order: 2,
    label: "样例2：虚拟团队 + 部门范围 setup",
  },
  "mixed-model-instance-hybrid.setup.json": {
    order: 3,
    label: "样例3：Model/Instance 混合 setup",
  },
  "department-kb-permissions.setup.json": {
    order: 4,
    label: "样例4：部门知识库权限 setup",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function resolveFixtureDirectory(): string {
  return path.resolve(__dirname, "../../api/test/fixtures");
}

function listSetupFixtureFiles(): string[] {
  const fixtureDir = resolveFixtureDirectory();
  return fs
    .readdirSync(fixtureDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".setup.json"))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const leftOrder =
        SETUP_FIXTURE_DISPLAY_OVERRIDES[left]?.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder =
        SETUP_FIXTURE_DISPLAY_OVERRIDES[right]?.order ??
        Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.localeCompare(right);
    });
}

function parseControlSetupFixture(raw: unknown): ControlSetupFixture | null {
  const fixture = asRecord(raw);
  if (!fixture) {
    return null;
  }

  const routeRecord = asRecord(fixture.route);
  const routeTenantId = normalizeString(routeRecord?.tenant_id);
  const routeEnvironment = normalizeString(routeRecord?.environment);
  const route =
    routeTenantId && routeEnvironment
      ? {
          tenant_id: routeTenantId,
          environment: routeEnvironment,
        }
      : undefined;

  const namespacePrefix = normalizeString(fixture.namespace_prefix);
  const objects: ControlSetupFixture["objects"] = Array.isArray(fixture.objects)
    ? fixture.objects.reduce<ControlSetupFixture["objects"]>((acc, item) => {
        const record = asRecord(item);
        if (!record) {
          return acc;
        }

        const objectId = normalizeString(record.object_id);
        const objectType = normalizeString(record.object_type);
        if (!objectId || !objectType) {
          return acc;
        }

        acc.push({
          object_id: objectId,
          object_type: objectType,
          sensitivity: normalizeString(record.sensitivity),
          owner_ref: normalizeString(record.owner_ref),
          labels: normalizeStringArray(record.labels),
        });
        return acc;
      }, [])
    : [];

  const relationEvents: ControlSetupFixture["relation_events"] = Array.isArray(
    fixture.relation_events,
  )
    ? fixture.relation_events.reduce<ControlSetupFixture["relation_events"]>(
        (acc, item) => {
          const record = asRecord(item);
          if (!record) {
            return acc;
          }

          const from = normalizeString(record.from);
          const to = normalizeString(record.to);
          const relationType = normalizeString(record.relation_type);
          if (!from || !to || !relationType) {
            return acc;
          }

          acc.push({
            from,
            to,
            relation_type: relationType,
            operation: record.operation === "delete" ? "delete" : "upsert",
            scope: normalizeString(record.scope),
            source: normalizeString(record.source),
          });
          return acc;
        },
        [],
      )
    : [];

  return {
    route,
    namespace_prefix: namespacePrefix,
    objects,
    relation_events: relationEvents,
  };
}

function readSetupFixtureFile(fileName: string): ControlSetupFixture | null {
  const fixturePath = path.resolve(resolveFixtureDirectory(), fileName);
  try {
    const raw = fs.readFileSync(fixturePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return parseControlSetupFixture(parsed);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    console.warn(
      `[console] skip invalid setup fixture: ${fixturePath} (${message})`,
    );
    return null;
  }
}

export function listSetupFixtureOptions(): SetupFixtureOption[] {
  const fixtureFiles = listSetupFixtureFiles();
  const options: SetupFixtureOption[] = [];

  fixtureFiles.forEach((fileName) => {
    const fixture = readSetupFixtureFile(fileName);
    if (!fixture) {
      return;
    }

    const id = fileName.replace(/\.setup\.json$/u, "");
    const override = SETUP_FIXTURE_DISPLAY_OVERRIDES[fileName];
    const routeTenant = fixture.route?.tenant_id ?? "-";
    const routeEnvironment = fixture.route?.environment ?? "-";
    const fallbackIndex = options.length + 1;
    const fallbackLabel = fixture.namespace_prefix ?? id;

    options.push({
      id,
      file_name: fileName,
      label: override?.label ?? `样例${fallbackIndex}：${fallbackLabel}`,
      description:
        `来源 fixtures/${fileName}` +
        `；tenant=${routeTenant}` +
        `；env=${routeEnvironment}` +
        `；objects=${fixture.objects.length}` +
        `；relations=${fixture.relation_events.length}`,
    });
  });

  return options;
}

export function loadSetupFixtureById(
  fixtureId: string,
): LoadedSetupFixture | null {
  const trimmedId = fixtureId.trim();
  if (trimmedId.length === 0 || !/^[a-zA-Z0-9._-]+$/u.test(trimmedId)) {
    return null;
  }

  const options = listSetupFixtureOptions();
  const target = options.find((item) => item.id === trimmedId);
  if (!target) {
    return null;
  }

  const fixture = readSetupFixtureFile(target.file_name);
  if (!fixture) {
    return null;
  }

  return {
    id: target.id,
    file_name: target.file_name,
    fixture,
  };
}
