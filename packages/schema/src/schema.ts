export const authzModelSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://acl.example.com/schemas/authz-model.schema.json',
  title: '企业权限模型配置 Schema',
  type: 'object',
  additionalProperties: false,
  required: [
    'model_meta',
    'catalogs',
    'object_onboarding',
    'policies',
    'constraints',
    'lifecycle',
    'consistency',
    'quality_guardrails',
  ],
  properties: {
    model_meta: {
      type: 'object',
      additionalProperties: false,
      required: ['model_id', 'tenant_id', 'version', 'status', 'combining_algorithm'],
      properties: {
        model_id: {
          type: 'string',
          minLength: 3,
          maxLength: 128,
          pattern: '^[a-zA-Z0-9._-]+$',
        },
        tenant_id: {
          type: 'string',
          minLength: 3,
          maxLength: 128,
          pattern: '^[a-zA-Z0-9._-]+$',
        },
        version: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
        },
        status: {
          type: 'string',
          enum: ['draft', 'published', 'archived'],
        },
        combining_algorithm: {
          type: 'string',
          enum: ['deny-overrides', 'permit-overrides', 'first-applicable', 'ordered-deny-overrides'],
        },
      },
    },
    catalogs: {
      type: 'object',
      additionalProperties: false,
      required: ['action_catalog', 'subject_type_catalog', 'object_type_catalog'],
      properties: {
        action_catalog: {
          type: 'array',
          items: { $ref: '#/$defs/action' },
          uniqueItems: true,
        },
        subject_type_catalog: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
        object_type_catalog: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
        relation_type_catalog: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
        subject_relation_type_catalog: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
        object_relation_type_catalog: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
        subject_object_relation_type_catalog: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
      },
      allOf: [
        {
          anyOf: [
            { required: ['relation_type_catalog'] },
            {
              required: [
                'subject_relation_type_catalog',
                'object_relation_type_catalog',
              ],
            },
          ],
        },
        {
          if: {
            anyOf: [
              { required: ['subject_relation_type_catalog'] },
              { required: ['object_relation_type_catalog'] },
              { required: ['subject_object_relation_type_catalog'] },
            ],
          },
          then: {
            required: [
              'subject_relation_type_catalog',
              'object_relation_type_catalog',
            ],
          },
        },
      ],
    },
    action_signature: {
      type: 'object',
      additionalProperties: false,
      required: ['tuples'],
      properties: {
        tuples: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/action_signature_tuple' },
        },
      },
    },
    object_onboarding: {
      type: 'object',
      additionalProperties: false,
      required: ['compatibility_mode', 'default_profile', 'profiles', 'conditional_required'],
      properties: {
        compatibility_mode: {
          type: 'string',
          enum: ['compat_open', 'compat_balanced', 'compat_strict'],
        },
        default_profile: {
          type: 'string',
          minLength: 1,
        },
        profiles: {
          type: 'object',
          minProperties: 1,
          additionalProperties: { $ref: '#/$defs/onboarding_profile' },
        },
        conditional_required: {
          type: 'array',
          items: { $ref: '#/$defs/conditional_required_rule' },
        },
      },
    },
    relations: {
      type: 'object',
      additionalProperties: false,
      required: ['subject_relations', 'object_relations', 'subject_object_relations'],
      properties: {
        subject_relations: {
          type: 'array',
          items: { $ref: '#/$defs/relation_edge' },
        },
        object_relations: {
          type: 'array',
          items: { $ref: '#/$defs/relation_edge' },
        },
        subject_object_relations: {
          type: 'array',
          items: { $ref: '#/$defs/relation_edge' },
        },
      },
    },
    policies: {
      type: 'object',
      additionalProperties: false,
      required: ['rules'],
      properties: {
        rules: {
          type: 'array',
          minItems: 0,
          items: { $ref: '#/$defs/policy_rule' },
        },
      },
    },
    constraints: {
      type: 'object',
      additionalProperties: false,
      required: ['sod_rules', 'cardinality_rules'],
      properties: {
        sod_rules: {
          type: 'array',
          items: { $ref: '#/$defs/sod_rule' },
        },
        cardinality_rules: {
          type: 'array',
          items: { $ref: '#/$defs/cardinality_rule' },
        },
      },
    },
    lifecycle: {
      type: 'object',
      additionalProperties: false,
      required: ['event_rules'],
      properties: {
        event_rules: {
          type: 'array',
          items: { $ref: '#/$defs/lifecycle_rule' },
        },
      },
    },
    consistency: {
      type: 'object',
      additionalProperties: false,
      required: ['default_level', 'high_risk_level'],
      properties: {
        default_level: {
          type: 'string',
          enum: ['strong', 'bounded_staleness', 'eventual'],
        },
        high_risk_level: {
          type: 'string',
          enum: ['strong', 'bounded_staleness'],
        },
        bounded_staleness_ms: {
          type: 'integer',
          minimum: 0,
          maximum: 600000,
        },
      },
    },
    quality_guardrails: {
      type: 'object',
      additionalProperties: false,
      required: ['attribute_quality', 'mandatory_obligations'],
      properties: {
        attribute_quality: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authority_whitelist: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
              uniqueItems: true,
            },
            freshness_ttl_sec: {
              type: 'object',
              additionalProperties: {
                type: 'integer',
                minimum: 1,
                maximum: 31536000,
              },
            },
            reject_unknown_source: { type: 'boolean' },
          },
        },
        mandatory_obligations: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
      },
    },
    context_inference: {
      type: 'object',
      additionalProperties: false,
      required: ['rules'],
      properties: {
        enabled: { type: 'boolean' },
        rules: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/context_inference_rule' },
        },
        constraints: { $ref: '#/$defs/context_inference_constraints' },
      },
    },
    decision_search: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled'],
      properties: {
        enabled: { type: 'boolean' },
        pushdown: { $ref: '#/$defs/search_pushdown' },
      },
    },
  },
  allOf: [
    {
      if: {
        properties: {
          model_meta: {
            properties: {
              status: { const: 'published' },
            },
            required: ['status'],
          },
        },
      },
      then: {
        required: ['action_signature'],
        properties: {
          catalogs: {
            properties: {
              action_catalog: { minItems: 1 },
              subject_type_catalog: { minItems: 1 },
              object_type_catalog: { minItems: 1 },
            },
            allOf: [
              {
                anyOf: [
                  {
                    required: ['relation_type_catalog'],
                    properties: {
                      relation_type_catalog: { minItems: 1 },
                    },
                  },
                  {
                    required: ['subject_relation_type_catalog'],
                    properties: {
                      subject_relation_type_catalog: { minItems: 1 },
                    },
                  },
                  {
                    required: ['object_relation_type_catalog'],
                    properties: {
                      object_relation_type_catalog: { minItems: 1 },
                    },
                  },
                  {
                    required: ['subject_object_relation_type_catalog'],
                    properties: {
                      subject_object_relation_type_catalog: { minItems: 1 },
                    },
                  },
                ],
              },
            ],
          },
          action_signature: {
            required: ['tuples'],
            properties: {
              tuples: { minItems: 1 },
            },
          },
          policies: {
            properties: {
              rules: {
                minItems: 1,
              },
            },
          },
        },
      },
    },
    {
      if: {
        properties: {
          decision_search: {
            properties: {
              enabled: { const: true },
            },
            required: ['enabled'],
          },
        },
      },
      then: {
        properties: {
          decision_search: {
            required: ['pushdown'],
          },
        },
      },
    },
    {
      if: {
        properties: {
          consistency: {
            properties: {
              default_level: { const: 'bounded_staleness' },
            },
            required: ['default_level'],
          },
        },
      },
      then: {
        properties: {
          consistency: {
            required: ['bounded_staleness_ms'],
            properties: {
              bounded_staleness_ms: {
                minimum: 1,
              },
            },
          },
        },
      },
    },
    {
      if: {
        properties: {
          model_meta: {
            properties: {
              combining_algorithm: { const: 'permit-overrides' },
            },
          },
        },
      },
      then: {
        $comment: '高敏域 permit-overrides 由语义校验器进一步拦截',
      },
    },
  ],
  $defs: {
    action: {
      type: 'string',
      pattern: '^[a-z][a-z0-9_.-]{1,63}$',
    },
    type_name: {
      type: 'string',
      pattern: '^[a-z][a-z0-9_.-]{1,63}$',
    },
    action_signature_tuple: {
      type: 'object',
      additionalProperties: false,
      required: ['subject_types', 'object_types', 'actions'],
      properties: {
        subject_types: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/type_name' },
          uniqueItems: true,
        },
        object_types: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/type_name' },
          uniqueItems: true,
        },
        actions: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/action' },
          uniqueItems: true,
        },
        enabled: { type: 'boolean' },
      },
    },
    validity: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: {
        start: { type: 'string', format: 'date-time' },
        end: { type: 'string', format: 'date-time' },
      },
    },
    relation_edge: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to', 'relation_type'],
      properties: {
        from: { type: 'string', minLength: 1 },
        to: { type: 'string', minLength: 1 },
        relation_type: { type: 'string', minLength: 1 },
        scope: { type: 'string' },
        source: { type: 'string' },
        validity: { $ref: '#/$defs/validity' },
      },
    },
    policy_rule: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'subject_selector', 'object_selector', 'action_set', 'effect', 'priority'],
      properties: {
        id: {
          type: 'string',
          pattern: '^[a-zA-Z0-9._-]{3,128}$',
        },
        subject_selector: { type: 'string', minLength: 3 },
        object_selector: { type: 'string', minLength: 3 },
        action_set: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/action' },
          uniqueItems: true,
        },
        effect: {
          type: 'string',
          enum: ['allow', 'deny'],
        },
        priority: {
          type: 'integer',
          minimum: 1,
          maximum: 10000,
        },
        conditions: { type: 'string' },
        validity: { $ref: '#/$defs/validity' },
        obligations: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
        advice: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
      },
    },
    sod_rule: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'forbidden_combination'],
      properties: {
        id: { type: 'string', minLength: 3 },
        forbidden_combination: {
          type: 'array',
          minItems: 2,
          items: { $ref: '#/$defs/action' },
          uniqueItems: true,
        },
      },
    },
    cardinality_rule: {
      type: 'object',
      additionalProperties: false,
      required: ['target', 'max_count'],
      properties: {
        target: { type: 'string', minLength: 1 },
        max_count: {
          type: 'integer',
          minimum: 1,
          maximum: 100000,
        },
      },
    },
    lifecycle_rule: {
      type: 'object',
      additionalProperties: false,
      required: ['event_type', 'handler'],
      properties: {
        event_type: { type: 'string', minLength: 1 },
        handler: { type: 'string', minLength: 1 },
        required: { type: 'boolean' },
      },
    },
    onboarding_profile: {
      type: 'object',
      additionalProperties: false,
      required: ['required_fields'],
      properties: {
        required_fields: {
          type: 'array',
          minItems: 4,
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
        autofill: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
    },
    conditional_required_rule: {
      type: 'object',
      additionalProperties: false,
      required: ['when', 'add_fields'],
      properties: {
        when: { type: 'string', minLength: 1 },
        add_fields: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
          uniqueItems: true,
        },
      },
    },
    context_inference_edge_selector: {
      type: 'object',
      additionalProperties: false,
      required: ['relation_type', 'entity_side'],
      properties: {
        relation_type: { type: 'string', minLength: 1 },
        entity_side: {
          type: 'string',
          enum: ['from', 'to'],
        },
        max_depth: {
          type: 'integer',
          minimum: 1,
          maximum: 16,
        },
      },
    },
    context_inference_constraints: {
      type: 'object',
      additionalProperties: false,
      properties: {
        monotonic_only: { type: 'boolean' },
        stratified_negation: { type: 'boolean' },
      },
    },
    context_inference_rule: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'output_field', 'subject_edges', 'object_edges'],
      properties: {
        id: {
          type: 'string',
          pattern: '^[a-zA-Z0-9._-]{3,128}$',
        },
        output_field: {
          type: 'string',
          pattern: '^[a-zA-Z_][a-zA-Z0-9_]{0,63}$',
        },
        subject_edges: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/context_inference_edge_selector' },
        },
        object_edges: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/context_inference_edge_selector' },
        },
        object_owner_fallback: { type: 'boolean' },
        owner_fallback_include_input: { type: 'boolean' },
      },
      allOf: [
        {
          if: {
            required: ['owner_fallback_include_input'],
          },
          then: {
            required: ['object_owner_fallback'],
            properties: {
              object_owner_fallback: {
                const: true,
              },
            },
          },
        },
      ],
    },
    search_pushdown: {
      type: 'object',
      additionalProperties: false,
      required: [
        'mode',
        'require_semantic_equivalence',
        'allow_conservative_superset',
        'max_candidates_scan',
      ],
      properties: {
        mode: {
          type: 'string',
          enum: ['safe', 'aggressive'],
        },
        require_semantic_equivalence: { type: 'boolean' },
        allow_conservative_superset: { type: 'boolean' },
        max_candidates_scan: {
          type: 'integer',
          minimum: 1,
          maximum: 1000000,
        },
      },
    },
  },
} as const;
