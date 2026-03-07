import { describe, expect, it, vi } from "vitest";

import type { AclApiClient } from "../src/acl-api-client";
import { maybeAutoAttachFixtureRoute } from "../src/server";

describe("server setup route bootstrap", () => {
  it("auto attaches fixture route when fixture setup posts instance_json without model_routes", async () => {
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

    const result = await maybeAutoAttachFixtureRoute({
      client: client as unknown as AclApiClient,
      namespaceInput: "tenant_a.crm",
      fixtureId: "01-same-company-derived",
      parsed: {
        namespace: "tenant_a.crm",
        model_routes: [],
        objects: [
          {
            object_id: "kb:wiki_core",
            object_type: "kb",
          },
        ],
        relation_events: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.parsed.model_routes).toHaveLength(1);
    expect(result.parsed.model_routes[0]?.tenant_id).toBe("tenant_acme");
    expect(result.summary?.publish_id).toBe("fixture_01_same_company");
    expect(client.submitPublishRequest).toHaveBeenCalledTimes(1);
    expect(client.activatePublishRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit model_routes untouched", async () => {
    const client = {
      submitPublishRequest: vi.fn(),
      reviewPublishRequest: vi.fn(),
      activatePublishRequest: vi.fn(),
    };

    const parsed = {
      namespace: "tenant_a.crm",
      model_routes: [
        {
          tenant_id: "tenant_acme",
          environment: "prod",
          model_id: "explicit_model",
        },
      ],
      objects: [],
      relation_events: [],
    };

    const result = await maybeAutoAttachFixtureRoute({
      client: client as unknown as AclApiClient,
      namespaceInput: "tenant_a.crm",
      fixtureId: "01-same-company-derived",
      parsed,
    });

    expect(result).toEqual({
      ok: true,
      parsed,
    });
    expect(client.submitPublishRequest).not.toHaveBeenCalled();
  });
});
