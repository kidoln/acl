import { describe, expect, it, vi } from "vitest";

import type { AclApiClient } from "../src/acl-api-client";
import { bootstrapFixtureRoute } from "../src/fixture-bootstrap";

describe("fixture bootstrap", () => {
  it("publishes fixture model, activates it, and returns route payload", async () => {
    const client = {
      submitPublishRequest: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          publish_id: "fixture_01_same_company",
          status: "approved",
        },
      }),
      reviewPublishRequest: vi.fn(),
      activatePublishRequest: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          status: "published",
        },
      }),
    };

    const result = await bootstrapFixtureRoute({
      client: client as unknown as AclApiClient,
      fixtureId: "01-same-company-derived",
      namespace: "tenant_a.crm",
      route: {
        tenant_id: "tenant_acme",
        environment: "prod",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.route.publish_id).toBe("fixture_01_same_company");
    expect(result.route.model_id).toBe("tenant_acme_same_company_visibility");
    expect(result.route.model_version).toBe("2026.03.05");
    expect(result.summary.publish_status).toBe("published");
    expect(result.summary.auto_reviewed).toBe(false);
    expect(result.summary.auto_activated).toBe(true);
    expect(client.reviewPublishRequest).not.toHaveBeenCalled();
    expect(client.activatePublishRequest).toHaveBeenCalledTimes(1);
  });

  it("auto-approves review_required fixture publishes before activation", async () => {
    const client = {
      submitPublishRequest: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          publish_id: "fixture_02_virtual_team",
          status: "review_required",
        },
      }),
      reviewPublishRequest: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          status: "approved",
        },
      }),
      activatePublishRequest: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          status: "published",
        },
      }),
    };

    const result = await bootstrapFixtureRoute({
      client: client as unknown as AclApiClient,
      fixtureId: "02-virtual-team-department-scope",
      namespace: "tenant_a.crm",
      route: {
        tenant_id: "tenant_acme",
        environment: "prod",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.summary.auto_reviewed).toBe(true);
    expect(result.summary.auto_activated).toBe(true);
    expect(client.reviewPublishRequest).toHaveBeenCalledTimes(1);
    expect(client.activatePublishRequest).toHaveBeenCalledTimes(1);
  });
});
