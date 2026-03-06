# 权限配置 JSON Schema 草案

> 文档编号：55  
> 更新日期：2026-03-06  
> 对应主文档：[`10_企业可配置权限模型设计.md`](./10_企业可配置权限模型设计.md) 第 13 章

## 1. 目标与范围

本文给出可直接用于机器校验的 JSON Schema 草案，用于约束权限模型配置的结构与基础语义。

范围说明：

1. 覆盖配置顶层结构与关键字段类型。  
2. 覆盖必填约束、枚举约束、基础区间约束。  
3. 覆盖部分跨字段规则（通过 `allOf/if/then` 表达）。  
4. 不在 Schema 中做复杂图遍历语义校验（由语义校验器承担）。

## 2. 设计原则

1. 先保证结构可校验，再补充语义校验。  
2. 错误定位应尽量落到字段路径。  
3. 对平台强制项尽量在 Schema 层前置。  
4. 对租户差异项通过枚举扩展和附加校验实现。

## 3. JSON Schema（Draft 2020-12）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://acl.example.com/schemas/authz-model.schema.json",
  "title": "企业权限模型配置 Schema",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "model_meta",
    "catalogs",
    "action_signature",
    "object_onboarding",
    "policies",
    "constraints",
    "lifecycle",
    "consistency",
    "quality_guardrails"
  ],
  "properties": {
    "model_meta": {
      "type": "object",
      "additionalProperties": false,
      "required": ["model_id", "tenant_id", "version", "status", "combining_algorithm"],
      "properties": {
        "model_id": {
          "type": "string",
          "minLength": 3,
          "maxLength": 128,
          "pattern": "^[a-zA-Z0-9._-]+$"
        },
        "tenant_id": {
          "type": "string",
          "minLength": 3,
          "maxLength": 128,
          "pattern": "^[a-zA-Z0-9._-]+$"
        },
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "status": {
          "type": "string",
          "enum": ["draft", "published", "archived"]
        },
        "combining_algorithm": {
          "type": "string",
          "enum": [
            "deny-overrides",
            "permit-overrides",
            "first-applicable",
            "ordered-deny-overrides"
          ]
        }
      }
    },
    "catalogs": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action_catalog",
        "subject_type_catalog",
        "object_type_catalog",
        "subject_relation_type_catalog",
        "object_relation_type_catalog"
      ],
      "properties": {
        "action_catalog": {
          "type": "array",
          "items": { "$ref": "#/$defs/action" },
          "uniqueItems": true
        },
        "subject_type_catalog": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "object_type_catalog": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "subject_relation_type_catalog": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "object_relation_type_catalog": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "subject_object_relation_type_catalog": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        }
      }
    },
    "action_signature": {
      "type": "object",
      "additionalProperties": false,
      "required": ["tuples"],
      "properties": {
        "tuples": {
          "type": "array",
          "items": { "$ref": "#/$defs/action_signature_tuple" },
          "uniqueItems": true
        }
      }
    },
    "object_onboarding": {
      "type": "object",
      "additionalProperties": false,
      "required": ["compatibility_mode", "default_profile", "profiles", "conditional_required"],
      "properties": {
        "compatibility_mode": {
          "type": "string",
          "enum": ["compat_open", "compat_balanced", "compat_strict"]
        },
        "default_profile": {
          "type": "string",
          "minLength": 1
        },
        "profiles": {
          "type": "object",
          "minProperties": 1,
          "additionalProperties": { "$ref": "#/$defs/onboarding_profile" }
        },
        "conditional_required": {
          "type": "array",
          "items": { "$ref": "#/$defs/conditional_required_rule" }
        }
      }
    },
    "context_inference": {
      "type": "object",
      "additionalProperties": false,
      "required": ["enabled", "rules", "constraints"],
      "properties": {
        "enabled": { "type": "boolean" },
        "rules": {
          "type": "array",
          "items": { "$ref": "#/$defs/inference_rule" }
        },
        "constraints": {
          "type": "object",
          "additionalProperties": false,
          "required": ["monotonic_only", "stratified_negation"],
          "properties": {
            "monotonic_only": { "type": "boolean" },
            "stratified_negation": { "type": "boolean" }
          }
        }
      }
    },
    "decision_search": {
      "type": "object",
      "additionalProperties": false,
      "required": ["enabled", "pushdown"],
      "properties": {
        "enabled": { "type": "boolean" },
        "pushdown": { "$ref": "#/$defs/search_pushdown" }
      }
    },
    "policies": {
      "type": "object",
      "additionalProperties": false,
      "required": ["rules"],
      "properties": {
        "rules": {
          "type": "array",
          "minItems": 0,
          "items": { "$ref": "#/$defs/policy_rule" }
        }
      }
    },
    "constraints": {
      "type": "object",
      "additionalProperties": false,
      "required": ["sod_rules", "cardinality_rules"],
      "properties": {
        "sod_rules": {
          "type": "array",
          "items": { "$ref": "#/$defs/sod_rule" }
        },
        "cardinality_rules": {
          "type": "array",
          "items": { "$ref": "#/$defs/cardinality_rule" }
        }
      }
    },
    "lifecycle": {
      "type": "object",
      "additionalProperties": false,
      "required": ["event_rules"],
      "properties": {
        "event_rules": {
          "type": "array",
          "items": { "$ref": "#/$defs/lifecycle_rule" }
        }
      }
    },
    "consistency": {
      "type": "object",
      "additionalProperties": false,
      "required": ["default_level", "high_risk_level"],
      "properties": {
        "default_level": {
          "type": "string",
          "enum": ["strong", "bounded_staleness", "eventual"]
        },
        "high_risk_level": {
          "type": "string",
          "enum": ["strong", "bounded_staleness"]
        },
        "bounded_staleness_ms": {
          "type": "integer",
          "minimum": 0,
          "maximum": 600000
        }
      }
    },
    "quality_guardrails": {
      "type": "object",
      "additionalProperties": false,
      "required": ["attribute_quality", "mandatory_obligations"],
      "properties": {
        "attribute_quality": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "authority_whitelist": {
              "type": "array",
              "items": { "type": "string", "minLength": 1 },
              "uniqueItems": true
            },
            "freshness_ttl_sec": {
              "type": "object",
              "additionalProperties": {
                "type": "integer",
                "minimum": 1,
                "maximum": 31536000
              }
            },
            "reject_unknown_source": { "type": "boolean" }
          }
        },
        "mandatory_obligations": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        }
      }
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "model_meta": {
            "properties": {
              "status": { "const": "published" }
            },
            "required": ["status"]
          }
        }
      },
      "then": {
        "properties": {
          "catalogs": {
            "properties": {
              "action_catalog": { "minItems": 1 },
              "subject_type_catalog": { "minItems": 1 },
              "object_type_catalog": { "minItems": 1 },
              "subject_relation_type_catalog": { "minItems": 1 },
              "object_relation_type_catalog": { "minItems": 1 }
            }
          },
          "action_signature": {
            "properties": {
              "tuples": { "minItems": 1 }
            }
          },
          "policies": {
            "properties": {
              "rules": {
                "minItems": 1
              }
            }
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "consistency": {
            "properties": {
              "default_level": { "const": "bounded_staleness" }
            },
            "required": ["default_level"]
          }
        }
      },
      "then": {
        "properties": {
          "consistency": {
            "required": ["bounded_staleness_ms"],
            "properties": {
              "bounded_staleness_ms": {
                "minimum": 1
              }
            }
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "model_meta": {
            "properties": {
              "combining_algorithm": { "const": "permit-overrides" }
            }
          }
        }
      },
      "then": {
        "$comment": "高敏域 permit-overrides 由语义校验器进一步拦截"
      }
    },
    {
      "if": {
        "properties": {
          "decision_search": {
            "properties": {
              "enabled": { "const": true },
              "pushdown": {
                "properties": {
                  "require_semantic_equivalence": { "const": false }
                },
                "required": ["require_semantic_equivalence"]
              }
            },
            "required": ["enabled", "pushdown"]
          }
        }
      },
      "then": {
        "properties": {
          "decision_search": {
            "properties": {
              "pushdown": {
                "properties": {
                  "allow_conservative_superset": { "const": true }
                },
                "required": ["allow_conservative_superset"]
              }
            }
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "context_inference": {
            "properties": {
              "enabled": { "const": true }
            },
            "required": ["enabled"]
          }
        }
      },
      "then": {
        "properties": {
          "context_inference": {
            "properties": {
              "rules": { "minItems": 1 }
            }
          }
        }
      }
    }
  ],
  "$defs": {
    "action": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_.-]{1,63}$"
    },
    "type_name": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_.-]{1,63}$"
    },
    "action_signature_tuple": {
      "type": "object",
      "additionalProperties": false,
      "required": ["subject_types", "object_types", "actions"],
      "properties": {
        "subject_types": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/type_name" },
          "uniqueItems": true
        },
        "object_types": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/type_name" },
          "uniqueItems": true
        },
        "actions": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/action" },
          "uniqueItems": true
        },
        "enabled": { "type": "boolean" }
      }
    },
    "inference_edge": {
      "type": "object",
      "additionalProperties": false,
      "required": ["relation_type", "entity_side"],
      "properties": {
        "relation_type": { "type": "string", "minLength": 1 },
        "entity_side": { "type": "string", "enum": ["from", "to"] },
        "max_depth": {
          "type": "integer",
          "minimum": 1,
          "maximum": 16
        }
      }
    },
    "inference_rule": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "output_field", "subject_edges", "object_edges"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-zA-Z0-9._-]{3,128}$"
        },
        "output_field": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_.-]{1,63}$"
        },
        "subject_edges": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/inference_edge" }
        },
        "object_edges": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/inference_edge" }
        },
        "object_owner_fallback": { "type": "boolean" },
        "owner_fallback_include_input": { "type": "boolean" }
      }
    },
    "search_pushdown": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "mode",
        "require_semantic_equivalence",
        "allow_conservative_superset",
        "max_candidates_scan"
      ],
      "properties": {
        "mode": {
          "type": "string",
          "enum": ["safe", "aggressive"]
        },
        "require_semantic_equivalence": { "type": "boolean" },
        "allow_conservative_superset": { "type": "boolean" },
        "max_candidates_scan": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000
        }
      }
    },
    "validity": {
      "type": "object",
      "additionalProperties": false,
      "required": ["start", "end"],
      "properties": {
        "start": { "type": "string", "format": "date-time" },
        "end": { "type": "string", "format": "date-time" }
      }
    },
    "policy_rule": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "subject_selector",
        "object_selector",
        "action_set",
        "effect",
        "priority"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-zA-Z0-9._-]{3,128}$"
        },
        "subject_selector": { "type": "string", "minLength": 3 },
        "object_selector": { "type": "string", "minLength": 3 },
        "action_set": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/action" },
          "uniqueItems": true
        },
        "effect": {
          "type": "string",
          "enum": ["allow", "deny"]
        },
        "priority": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "conditions": { "type": "string" },
        "validity": { "$ref": "#/$defs/validity" },
        "obligations": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "advice": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        }
      }
    },
    "sod_rule": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "forbidden_combination"],
      "properties": {
        "id": { "type": "string", "minLength": 3 },
        "forbidden_combination": {
          "type": "array",
          "minItems": 2,
          "items": { "$ref": "#/$defs/action" },
          "uniqueItems": true
        }
      }
    },
    "cardinality_rule": {
      "type": "object",
      "additionalProperties": false,
      "required": ["target", "max_count"],
      "properties": {
        "target": { "type": "string", "minLength": 1 },
        "max_count": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100000
        }
      }
    },
    "lifecycle_rule": {
      "type": "object",
      "additionalProperties": false,
      "required": ["event_type", "handler"],
      "properties": {
        "event_type": { "type": "string", "minLength": 1 },
        "handler": { "type": "string", "minLength": 1 },
        "required": { "type": "boolean" }
      }
    },
    "onboarding_profile": {
      "type": "object",
      "additionalProperties": false,
      "required": ["required_fields"],
      "properties": {
        "required_fields": {
          "type": "array",
          "minItems": 4,
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "autofill": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        }
      }
    },
    "conditional_required_rule": {
      "type": "object",
      "additionalProperties": false,
      "required": ["when", "add_fields"],
      "properties": {
        "when": { "type": "string", "minLength": 1 },
        "add_fields": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        }
      }
    }
  }
}
```

## 4. 语义校验器补充规则（Schema 外）

以下规则不适合仅靠 JSON Schema 完成，建议由语义校验器补充：

1. `subject_selector/object_selector` 的表达式 AST 校验与类型推断。  
2. `relation_type` 是否已在 Catalog 注册并允许在当前关系域使用。  
3. `action_signature.tuples` 中的 `subject_types/object_types/actions` 必须分别在对应 Catalog 中已注册。  
4. `policies.rules[].action_set` 命中到的 `(subject_type, object_type, action)` 三元组不得越出 `action_signature`。  
5. `context_inference.rules[]` 仅允许受控可判定子集（纯正规则或分层否定），禁止递归否定与无界聚合。  
6. `context_inference.rules[].subject_edges/object_edges` 中的 `relation_type` 必须在对应关系域 catalog 注册。  
7. `owner_fallback_include_input` 仅在 `object_owner_fallback=true` 时有效；当 `object_owner_fallback=false` 时应视为“无效字段值”（建议告警或拒绝）。  
8. 若 `decision_search.enabled=true` 且 `require_semantic_equivalence=false`，必须验证“保守候选超集 + 残差精评估”语义成立。  
9. `Decision Search` 下推计划需可解释：返回可下推子句、残差子句与判据类型。  
10. 高敏域禁止 `eventual` 一致性。  
11. 高敏 allow 规则必须包含 mandatory obligations。  
12. 冲突规则可消歧性校验（优先级 + 合并算法）。  
13. `default_profile` 必须存在于 `profiles`。  
14. 每个 Profile 的 `required_fields` 至少包含硬必填四项。  
15. `compat_strict` 模式下，条件必填字段缺失应拒绝入管。  
16. `subject_removed` 等关键事件必须存在且 `required=true`。  
17. `RULE_CONFLICT_UNRESOLVED`、`ACTION_SIGNATURE_MISMATCH`、`SEARCH_PUSHDOWN_UNSAFE` 与 `OBLIGATION_NOT_EXECUTABLE` 归属 `P0` 阻断。

### 4.2 `relation_signature`（新增）

用于声明关系类型的端点签名，避免把同一 `relation_type` 误用到不合法端点组合：

```json
{
  "relation_signature": {
    "subject_relations": [
      {
        "relation_type": "belongs_to_company",
        "from_types": ["department"],
        "to_types": ["company"]
      }
    ],
    "object_relations": [
      {
        "relation_type": "derives_to",
        "from_types": ["kb"],
        "to_types": ["kb"]
      }
    ],
    "subject_object_relations": [
      {
        "relation_type": "can_read",
        "from_types": ["user"],
        "to_types": ["kb"]
      }
    ]
  }
}
```

约束说明：

1. `relation_signature` 为模型级关系端点签名声明，不承载实例关系数据。  
2. 每个签名元组必须包含 `relation_type/from_types/to_types`，且 `from_types/to_types` 不可为空。  
3. 端点类型集合由 `catalogs.subject_type_catalog/object_type_catalog` 约束，越界类型由语义校验器拦截为 `RELATION_SIGNATURE_MISMATCH`。

### 4.1 `owner_fallback_include_input` 使用约定（新增）

为避免“衍生资源可见”与“输入资源 owner 兜底”语义混淆，规则解释固定如下：

1. `object_owner_fallback=true` 且 `owner_fallback_include_input=true`：  
   owner 兜底对象集合 = `{输入对象} ∪ object_edges 扩展结果`。
2. `object_owner_fallback=true` 且 `owner_fallback_include_input=false`：  
   owner 兜底对象集合 = `object_edges 扩展结果`（不含输入对象）。
3. `object_owner_fallback=false`：  
   不执行 owner 兜底，`owner_fallback_include_input` 不参与求值。
4. 默认值建议：`owner_fallback_include_input=true`（与当前运行时保持一致）。

配置决策速查表（面向普通配置用户）：

| 场景描述 | `object_owner_fallback` | `owner_fallback_include_input` |
| --- | --- | --- |
| 直接对象按 owner 归属判权 | `true` | `true` |
| 衍生对象按来源对象 owner 判权 | `true` | `false` |
| 完全基于对象关系边判权（不看 owner） | `false` | 不填 |

可直接复制的规则片段：

```json
{
  "id": "infer_same_company_direct",
  "output_field": "same_company_direct",
  "subject_edges": [
    { "relation_type": "belongs_to_department", "entity_side": "from" },
    { "relation_type": "belongs_to_company", "entity_side": "from" }
  ],
  "object_edges": [
    { "relation_type": "derives_to", "entity_side": "from" }
  ],
  "object_owner_fallback": true,
  "owner_fallback_include_input": true
}
```

```json
{
  "id": "infer_same_company_via_source",
  "output_field": "same_company_via_source",
  "subject_edges": [
    { "relation_type": "belongs_to_department", "entity_side": "from" },
    { "relation_type": "belongs_to_company", "entity_side": "from" }
  ],
  "object_edges": [
    { "relation_type": "derives_to", "entity_side": "to" }
  ],
  "object_owner_fallback": true,
  "owner_fallback_include_input": false
}
```

```json
{
  "id": "infer_same_department_no_owner_fallback",
  "output_field": "same_department",
  "subject_edges": [
    { "relation_type": "belongs_to", "entity_side": "from" }
  ],
  "object_edges": [
    { "relation_type": "owned_by_department", "entity_side": "from" }
  ],
  "object_owner_fallback": false
}
```

## 5. 最小通过示例

```json
{
  "model_meta": {
    "model_id": "tenant_a_authz_v1",
    "tenant_id": "tenant_a",
    "version": "2026.03.05",
    "status": "draft",
    "combining_algorithm": "deny-overrides"
  },
  "catalogs": {
    "action_catalog": ["read", "update", "grant"],
    "subject_type_catalog": ["user", "group", "department"],
    "object_type_catalog": ["kb", "agent"],
    "subject_relation_type_catalog": ["belongs_to", "member_of", "manages"],
    "object_relation_type_catalog": ["derives_to"],
    "subject_object_relation_type_catalog": ["owns"]
  },
  "action_signature": {
    "tuples": [
      {
        "subject_types": ["user"],
        "object_types": ["kb"],
        "actions": ["read", "update", "grant"],
        "enabled": true
      },
      {
        "subject_types": ["group"],
        "object_types": ["kb"],
        "actions": ["read"],
        "enabled": true
      }
    ]
  },
  "object_onboarding": {
    "compatibility_mode": "compat_balanced",
    "default_profile": "minimal",
    "profiles": {
      "minimal": {
        "required_fields": ["tenant_id", "object_id", "object_type", "created_by"],
        "autofill": {
          "owner_ref": "created_by",
          "sensitivity": "normal"
        }
      }
    },
    "conditional_required": [
      {
        "when": "object.sensitivity == high",
        "add_fields": ["data_domain", "retention_class"]
      }
    ]
  },
  "context_inference": {
    "enabled": true,
    "rules": [
      {
        "id": "infer_same_department",
        "output_field": "same_department",
        "subject_edges": [
          { "relation_type": "belongs_to", "entity_side": "from" }
        ],
        "object_edges": [
          { "relation_type": "owns", "entity_side": "to" }
        ],
        "object_owner_fallback": true,
        "owner_fallback_include_input": true
      }
    ],
    "constraints": {
      "monotonic_only": true,
      "stratified_negation": true
    }
  },
  "decision_search": {
    "enabled": true,
    "pushdown": {
      "mode": "safe",
      "require_semantic_equivalence": true,
      "allow_conservative_superset": true,
      "max_candidates_scan": 5000
    }
  },
  "policies": {
    "rules": [
      {
        "id": "rule_read_kb",
        "subject_selector": "subject.relations includes member_of(group:g1)",
        "object_selector": "object.type == kb",
        "action_set": ["read"],
        "effect": "allow",
        "priority": 100
      }
    ]
  },
  "constraints": {
    "sod_rules": [],
    "cardinality_rules": []
  },
  "lifecycle": {
    "event_rules": [
      {
        "event_type": "subject_removed",
        "handler": "revoke_direct_edges",
        "required": true
      }
    ]
  },
  "consistency": {
    "default_level": "bounded_staleness",
    "high_risk_level": "strong",
    "bounded_staleness_ms": 3000
  },
  "quality_guardrails": {
    "attribute_quality": {
      "authority_whitelist": ["hr_system"],
      "freshness_ttl_sec": {
        "department_membership": 900
      },
      "reject_unknown_source": true
    },
    "mandatory_obligations": ["audit_write"]
  }
}
```

## 6. 常见失败样例（对应错误码）

1. `policies.rules` 为空且状态为 `published`。  
对应：`SCHEMA_VALIDATION_FAILED` 或发布门禁 `P0` 失败。

2. `priority` 超出区间（如 `0` 或 `10001`）。  
对应：Schema 校验失败。

3. `action_set` 出现未注册动作。  
对应：`ACTION_NOT_REGISTERED`。

4. 规则命中的 `subject_type/object_type/action` 三元组不在 `action_signature`。  
对应：`ACTION_SIGNATURE_MISMATCH`。

5. `context_inference.rules` 出现递归否定或无界聚合。  
对应：`INFERENCE_RULE_UNSAFE`。

6. `decision_search` 下推无法证明等价，且又不满足“保守超集 + 残差求值”条件。  
对应：`SEARCH_PUSHDOWN_UNSAFE`。

7. 高敏域规则配置为 `eventual`。  
对应：`HIGH_SENSITIVITY_DOWNGRADED`。

8. 关系边端点类型不在 `relation_signature` 允许组合中。  
对应：`RELATION_SIGNATURE_MISMATCH`。

## 7. 与主文档映射关系

1. 对应 `10` 文档第 `6.1`、`6.2`、`6.3` 的动作签名与关系端点签名边界。  
2. 对应 `10` 文档第 `10.4.8`、`10.4.9`、`10.4.10` 的推导规则与检索下推语义。  
3. 对应 `10` 文档第 `13.2`、`13.3`、`13.4` 的语法定义。  
4. 对应 `10` 文档第 `13.5`、`13.6`、`13.7` 的校验、冲突与编译产物规则。  
5. 对应 `10` 文档第 `13.10`、`13.11`、`13.12` 的错误码与门禁语义。

## 8. 统一错误码索引（新增）

以下索引用于把 Schema 校验、语义校验与发布门禁统一到同一组错误码语义（以 `10` 文档 `13.14` 为准）。

| 错误码 | 默认级别 | 典型检测层 | 12 门禁层级（默认） | 是否阻断发布（默认） | 典型检测指标/条件 | 最小处置建议 |
| --- | --- | --- | --- | --- | --- | --- |
| `ACTION_NOT_REGISTERED` | error | 语义校验 | `P0` | 是 | `semantic.unregistered_action_count == 0` | 补充动作目录或修正规则动作集 |
| `ACTION_SIGNATURE_MISMATCH` | error | 语义校验 | `P0` | 是 | `semantic.action_signature_mismatch_count == 0` | 补充 `action_signature.tuples` 或收敛规则类型组合 |
| `RELATION_SIGNATURE_MISMATCH` | error | 语义校验 | `P0` | 是 | `semantic.relation_signature_mismatch_count == 0` | 补充 `relation_signature` 或修正关系端点类型 |
| `INFERENCE_RULE_UNSAFE` | error | 语义/安全校验 | `P0` | 是 | `semantic.inference_rule_unsafe_count == 0` | 将推导规则收敛到可判定子集（纯正规则/分层否定） |
| `SEARCH_PUSHDOWN_UNSAFE` | error | 安全/可执行性校验 | `P0` | 是 | `search.enabled == false or search.pushdown_unsafe_count == 0` | 降级 `EvaluateOnly` 或启用保守超集+残差求值 |
| `SEARCH_SEMANTIC_DRIFT` | warning | 影子对比/模拟校验 | 未强制（建议 `P2`） | 否 | 检索结果与逐对象完整求值存在差异 | 收紧下推策略并回放差异样本 |
| `RULE_CONFLICT_UNRESOLVED` | error | 冲突校验 | `P0` | 是 | `conflict.unresolved_count == 0` | 拆分选择器、调整优先级或改合并算法 |
| `OBLIGATION_NOT_EXECUTABLE` | error | 可执行性校验 | `P0` | 是 | `execution.mandatory_obligation_static_unexecutable_count == 0` | 修复 obligations 执行链路与依赖 |
| `OBLIGATION_EXECUTION_DEGRADED` | warning | 运行可执行性校验 | `P2` | 否（进入复核） | `execution.mandatory_obligation_pass_rate >= threshold` | 修复执行稳定性并收敛阈值 |
