# 权限配置 JSON Schema 草案

> 文档编号：55  
> 更新日期：2026-03-04  
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
    "object_onboarding",
    "relations",
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
        "relation_type_catalog"
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
        "relation_type_catalog": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
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
    "relations": {
      "type": "object",
      "additionalProperties": false,
      "required": ["subject_relations", "object_relations", "subject_object_relations"],
      "properties": {
        "subject_relations": {
          "type": "array",
          "items": { "$ref": "#/$defs/relation_edge" }
        },
        "object_relations": {
          "type": "array",
          "items": { "$ref": "#/$defs/relation_edge" }
        },
        "subject_object_relations": {
          "type": "array",
          "items": { "$ref": "#/$defs/relation_edge" }
        }
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
              "object_type_catalog": { "minItems": 1 },
              "relation_type_catalog": { "minItems": 1 }
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
    }
  ],
  "$defs": {
    "action": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_.-]{1,63}$"
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
    "relation_edge": {
      "type": "object",
      "additionalProperties": false,
      "required": ["from", "to", "relation_type"],
      "properties": {
        "from": { "type": "string", "minLength": 1 },
        "to": { "type": "string", "minLength": 1 },
        "relation_type": { "type": "string", "minLength": 1 },
        "scope": { "type": "string" },
        "source": { "type": "string" },
        "validity": { "$ref": "#/$defs/validity" }
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
3. 高敏域禁止 `eventual` 一致性。  
4. 高敏 allow 规则必须包含 mandatory obligations。  
5. 冲突规则可消歧性校验（优先级 + 合并算法）。
6. `default_profile` 必须存在于 `profiles`。  
7. 每个 Profile 的 `required_fields` 至少包含硬必填四项。  
8. `compat_strict` 模式下，条件必填字段缺失应拒绝入管。  
9. `subject_removed` 等关键事件必须存在且 `required=true`。  
10. `RULE_CONFLICT_UNRESOLVED` 与 `OBLIGATION_NOT_EXECUTABLE` 归属 `P0` 阻断。

## 5. 最小通过示例

```json
{
  "model_meta": {
    "model_id": "tenant_a_authz_v1",
    "tenant_id": "tenant_a",
    "version": "2026.03.04",
    "status": "draft",
    "combining_algorithm": "deny-overrides"
  },
  "catalogs": {
    "action_catalog": ["read", "update", "grant"],
    "subject_type_catalog": ["user", "group"],
    "object_type_catalog": ["kb", "agent"],
    "relation_type_catalog": ["belongs_to", "member_of", "manages", "derives_to"]
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
  "relations": {
    "subject_relations": [],
    "object_relations": [],
    "subject_object_relations": []
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

4. 高敏域规则配置为 `eventual`。  
对应：`HIGH_SENSITIVITY_DOWNGRADED`。

## 7. 与主文档映射关系

1. 对应 `10` 文档第 `13.2`、`13.3`、`13.4` 的语法定义。  
2. 对应 `10` 文档第 `13.5`、`13.6` 的校验与冲突规则。  
3. 对应 `10` 文档第 `13.10`、`13.11`、`13.12` 的错误码与门禁语义。
