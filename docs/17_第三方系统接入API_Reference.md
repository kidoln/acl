# 第三方系统接入 API Reference（面向大模型编程）

> 文档编号：17  
> 更新日期：2026-03-09  
> 面向对象：第三方系统开发者、集成人员、使用大模型生成接入代码的研发团队  
> 需求解释顺序：`docs/10` > `docs/11` > `docs/12` > `AGENTS.md` > 本文档  
> 术语遵循 [00_术语统一规范](./00_术语统一规范.md)  
> 设计主文档：[10_企业可配置权限模型开发设计.md](./10_企业可配置权限模型开发设计.md)  
> 配置结构参考：[11_权限配置JSON_Schema草案.md](./11_权限配置JSON_Schema草案.md)  
> 发布门禁参考：[12_权限发布门禁规则样例.md](./12_权限发布门禁规则样例.md)

## 1. 文档定位

本文档是**当前实现版本**的正式 API Reference，目标不是解释“为什么这样设计”，而是回答第三方系统接入时最关心的四件事：

1. 应该调用哪些接口。  
2. 每个接口的请求和响应应该长什么样。  
3. `tenant`、`namespace`、`model_route`、`publish` 应该如何配合。  
4. 当接入代码由大模型生成时，哪些约束必须显式写死，不能靠猜。

本文档与设计文档的关系如下：

1. [10_企业可配置权限模型开发设计.md](./10_企业可配置权限模型开发设计.md) 定义“控制面 + 数据面”的总接入模型，是最高优先级依据。  
2. [11_权限配置JSON_Schema草案.md](./11_权限配置JSON_Schema草案.md) 负责 `model` 配置结构与基础校验。  
3. [12_权限发布门禁规则样例.md](./12_权限发布门禁规则样例.md) 负责发布门禁语义与阈值样例。  
4. 本文档只负责把**当前已实现 API**整理成接入手册。

若本文档与主设计存在不一致，以 `docs/10` 为准；若本文档与代码实现存在不一致，以 `apps/api/src/main.ts` 当前实现为准，并应尽快修正文档。

## 2. 给大模型的硬约束

如果你是用大模型生成接入代码，请把下面这些规则当成**硬约束**，而不是“建议”：

1. **不要杜撰字段名**。请求体字段必须与本文档完全一致，例如 `model_route`、`tenant_id`、`namespace`、`publish_id`、`object_type`。  
2. **不要混淆 `tenant` 与 `namespace`**。`tenant_id` 是归属边界，`namespace` 是运行态工作区，两者不是一回事。  
3. **生产环境优先使用 `model_route`，不要把完整 `model` 长期内嵌到业务服务里**。内嵌 `model` 只适合本地调试、测试或一次性工具。  
4. **`Decision Search` 只返回 `allow` 对象**。不要期待它返回 `deny`、`not_applicable` 或 `indeterminate` 的对象列表。  
5. **高风险动作在真正执行前仍应用 `POST /decisions:evaluate` 再做一次强校验**，不要仅凭搜索结果直接执行。  
6. **`environment` 应视为大小写不敏感，但写入时请统一使用小写**，例如 `prod`、`staging`。  
7. **所有时间字段都应传 ISO 8601 字符串**，推荐 UTC，例如 `2026-03-09T12:00:00.000Z`。  
8. **批量 Upsert 接口没有幂等键字段**。如果需要安全重试，请保证重复请求中的主键语义一致：  
   - 对象主键：`namespace + object_id`  
   - 关系主键：`namespace + from + to + relation_type + scope`  
   - 模型路由主键：`namespace + tenant_id + environment`  
9. **错误处理必须分支处理 HTTP 状态码**，不要把所有非 200 都当成同一种失败。`400/404/409/422/500` 语义不同。  
10. **不要猜测认证方式**。当前应用层实现未声明固定认证头；生产环境通常应由网关、反向代理或服务网格补齐认证与访问控制。

## 3. 核心术语速查

| 术语 | 含义 | 第三方接入时怎么用 |
| --- | --- | --- |
| `tenant_id` | 权限归属边界 | 标识这套模型和运行事实属于哪个租户 |
| `namespace` | 运行态工作区 | 隔离对象、关系、路由、审计数据，通常对应一个业务域或一个被治理系统 |
| `model` | 权限模型配置 JSON | 定义动作目录、关系签名、规则、上下文推导、对象入管配置等 |
| `publish_id` | 一次模型发布记录 ID | 代表一张经过门禁、复核、激活的上线单 |
| `model_route` | 运行态路由 | 把某个 `namespace + tenant_id + environment` 指向一个已发布模型 |
| 控制面 | 注册“要管什么” | 同步对象、关系、模型路由 |
| 数据面 | 判定“这次能不能做” | 调用 `Decision Evaluate` 或 `Decision Search` |

请牢记：

1. `namespace` 不是 `tenant_id`。  
2. `publish` 不是 `model_route`。前者解决“模型能不能上线”，后者解决“运行态当前用哪个已发布模型”。  
3. 如果你在数据面使用 `model_route`，那么目标路由必须已经指向一个**已发布**模型。

## 4. 接入模式建议

### 4.1 最小接入（本地调试 / PoC）

适用场景：

1. 本地验证一份 `model` 是否可判权。  
2. 没有发布流程、没有控制面实例同步，只想尽快打通一个 Demo。  
3. 大模型先生成一个小型 CLI 或测试脚本。

推荐调用顺序：

1. `POST /models:validate` 先做结构校验。  
2. `POST /decisions:evaluate` 直接把 `model` 放到请求体里。  
3. 如需集合检索，再调用 `POST /decisions/search`。

### 4.2 标准接入（第三方系统正式联调）

适用场景：

1. 模型需要经过发布门禁。  
2. 运行态对象和关系会持续变化。  
3. 多个环境共用同一套 ACL 能力，但每个环境走不同路由。

推荐调用顺序：

1. `POST /publish/submit` 提交发布。  
2. 如状态为 `review_required`，调用 `POST /publish/review`。  
3. 调用 `POST /publish/activate` 激活。  
4. 调用 `POST /control/model-routes:upsert` 建立运行态路由。  
5. 持续调用 `POST /control/objects:upsert` 同步对象。  
6. 持续调用 `POST /control/relations:events` 同步关系。  
7. 业务请求实时调用 `POST /decisions:evaluate` 或 `POST /decisions/search`。

## 5. HTTP 约定

### 5.1 基本约定

1. 当前实现没有 `/v1` 前缀，路径即文档中列出的原始路径。  
2. 请求与响应均为 JSON。  
3. 建议所有调用都显式设置 `Content-Type: application/json`。  
4. 当前实现未在应用层声明固定认证头；生产环境可在接入网关层追加认证。  
5. `GET` 列表接口的通用分页参数为 `limit` 与 `offset`。  
6. `POST /decisions/search` 使用 `page.cursor`，它是**不透明游标**，调用方应原样透传，不要自行解析。

### 5.2 通用错误对象

大多数错误返回符合以下结构：

```json
{
  "code": "INVALID_REQUEST",
  "message": "human readable message"
}
```

常见状态码语义：

| 状态码 | 含义 | 调用方动作 |
| --- | --- | --- |
| `400` | 请求字段缺失、格式非法、枚举值错误 | 立即修正请求，不要重试原请求 |
| `404` | 目标资源不存在，例如路由、报告、发布单找不到 | 先确认前置资源是否已创建 |
| `409` | 语义冲突或约束冲突，例如约束违规、路由与模型不一致 | 修正模型或路由，不要盲目重试 |
| `422` | 模型校验失败 | 修正 `model` 配置后再试 |
| `500` | 持久化或服务内部失败 | 可按调用方容灾策略有限次重试 |

### 5.3 列表分页约束

以下列表接口使用 `limit + offset`：

1. `GET /control/objects`  
2. `GET /control/relations`  
3. `GET /control/audits`  
4. `GET /control/model-routes`  
5. `GET /publish/requests`  
6. `GET /publish/simulations`  
7. `GET /decisions`

分页约束：

1. `limit` 必须为整数，范围 `[1, 100]`。  
2. `offset` 必须为整数，且 `>= 0`。  
3. 若参数非法，会返回 `400 INVALID_REQUEST`。

## 6. API 总览

| 分类 | 方法 | 路径 | 用途 |
| --- | --- | --- | --- |
| 健康检查 | `GET` | `/healthz` | 服务健康状态 |
| DSL 工具 | `POST` | `/selectors:parse` | 解析 selector 字符串 |
| 模型校验 | `POST` | `/models:validate` | 校验模型配置 |
| 入管预检 | `POST` | `/objects:onboard-check` | 校验对象是否满足入管要求 |
| 发布门禁 | `POST` | `/publish:gate-check` | 仅做门禁检查，不创建发布流程 |
| 发布模拟 | `POST` | `/publish:simulate` | 生成发布影响模拟报告 |
| 模拟报告查询 | `GET` | `/publish/simulations` | 列表查询模拟报告 |
| 模拟报告详情 | `GET` | `/publish/simulations/:id` | 查询单个模拟报告 |
| 发布提交 | `POST` | `/publish/submit` | 创建发布单并保存门禁结果 |
| 发布列表 | `GET` | `/publish/requests` | 查询发布单 |
| 发布详情 | `GET` | `/publish/requests/:id` | 查询发布单详情 |
| 发布详情兼容路径 | `GET` | `/publish:requests/:id` | 与上一条等价 |
| 发布复核 | `POST` | `/publish/review` | 复核批准或驳回 |
| 发布激活 | `POST` | `/publish/activate` | 将发布单置为 `published` |
| 控制面对象同步 | `POST` | `/control/objects:upsert` | 批量 Upsert 对象 |
| 控制面对象查询 | `GET` | `/control/objects` | 查询对象台账 |
| 控制面关系同步 | `POST` | `/control/relations:events` | 批量同步关系事件 |
| 控制面关系查询 | `GET` | `/control/relations` | 查询关系边 |
| 控制面审计查询 | `GET` | `/control/audits` | 查询控制面审计记录 |
| 模型路由 Upsert | `POST` | `/control/model-routes:upsert` | 建立或更新运行态路由 |
| 模型路由查询 | `GET` | `/control/model-routes` | 查询路由 |
| 单次判权 | `POST` | `/decisions:evaluate` | 单对象四值决策 |
| 可见对象检索 | `POST` | `/decisions/search` | 返回 `allow` 对象集合 |
| 判权详情 | `GET` | `/decisions/:id` | 查询单次判权记录 |
| 判权列表 | `GET` | `/decisions` | 查询判权记录 |
| 生命周期处理 | `POST` | `/lifecycle:subject-removed` | 主体移除后的生命周期收敛处理 |
| 生命周期报告 | `GET` | `/lifecycle-reports/:id` | 查询生命周期执行报告 |

## 7. 模型与工具接口

### 7.1 `GET /healthz`

用途：检查 API 服务是否可用。

成功响应示意：

```json
{
  "service": "acl-api",
  "status": "ok",
  "persistence_driver": "memory",
  "timestamp": "2026-03-09T10:00:00.000Z"
}
```

### 7.2 `POST /selectors:parse`

用途：把策略 DSL 中的 selector 字符串解析为 AST，适合控制台、脚手架、静态检查工具使用。

请求体：

```json
{
  "selector": "subject.type == user and context.same_department == true",
  "scope": "subject_selector"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `selector` | `string` | 是 | 待解析的 DSL 表达式 |
| `scope` | `string` | 是 | `subject_selector` 或 `object_selector` |

失败条件：

1. `selector` 不是字符串。  
2. `scope` 不是 `subject_selector/object_selector`。

### 7.3 `POST /models:validate`

用途：校验一份 `model` 是否满足结构、目录、关系签名和基础约束要求。

请求体：

```json
{
  "model": {
    "model_meta": {
      "model_id": "tenant_a_kb_acl",
      "tenant_id": "tenant_a",
      "version": "2026.03.09",
      "status": "draft"
    }
  },
  "options": {
    "available_obligation_executors": ["audit_write"],
    "cardinality_counts": {
      "role:approver": 2
    }
  }
}
```

响应特征：

1. 成功时返回 `validation_id`、`persisted_at`、`persistence_driver`。  
2. 同时返回 `validateModelConfig` 的结果对象，例如 `valid`、`errors`、`warnings` 等。  
3. 之后可通过 `GET /validations/:id` 读取落库记录。

### 7.4 `GET /validations/:id`

用途：查询某次模型校验结果。

失败条件：

1. 记录不存在时返回 `404 NOT_FOUND`。

## 8. 对象入管预检接口

### 8.1 `POST /objects:onboard-check`

用途：在把对象真正同步到控制面之前，先用 `model.object_onboarding` 规则判断该对象是否满足硬必填、档位必填和条件必填要求。

请求体：

```json
{
  "model": {
    "object_onboarding": {
      "default_profile": "minimal",
      "compatibility_mode": "compat_balanced",
      "profiles": {
        "minimal": {
          "required_fields": ["owner_ref"]
        }
      },
      "conditional_required": []
    }
  },
  "object": {
    "tenant_id": "tenant_a",
    "object_id": "kb:doc_1001",
    "object_type": "kb",
    "created_by": "user:alice",
    "owner_ref": "user:alice"
  },
  "profile": "minimal"
}
```

成功响应示意：

```json
{
  "accepted": true,
  "compatibility_mode": "compat_balanced",
  "selected_profile": "minimal",
  "required_fields": ["tenant_id", "object_id", "object_type", "created_by", "owner_ref"],
  "missing_fields": [],
  "detail": {
    "hard_missing": [],
    "profile_missing": [],
    "conditional_missing": []
  },
  "blocking_errors": [],
  "warnings": []
}
```

关键规则：

1. 硬必填固定包含：`tenant_id`、`object_id`、`object_type`、`created_by`。  
2. `profile` 不传时，默认使用 `model.object_onboarding.default_profile`。  
3. `compatibility_mode` 会影响缺字段时是阻断还是仅告警。

常见失败：

1. `model` 或 `object` 缺失时返回 `400 INVALID_REQUEST`。  
2. `profile` 找不到时返回 `400 OBJECT_PROFILE_REQUIRED_MISSING`。

## 9. 控制面同步接口

### 9.1 `POST /control/objects:upsert`

用途：向某个 `namespace` 批量 Upsert 对象台账。

请求体：

```json
{
  "namespace": "tenant_a.kb",
  "objects": [
    {
      "object_id": "kb:doc_1001",
      "object_type": "kb",
      "sensitivity": "normal",
      "owner_ref": "user:alice",
      "labels": ["project_alpha"],
      "updated_at": "2026-03-09T10:00:00.000Z"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `namespace` | `string` | 是 | 运行态工作区 |
| `objects[]` | `array` | 是 | 待写入对象列表，不能为空 |
| `object_id` | `string` | 是 | 对象主键 |
| `object_type` | `string` | 是 | 对象类型 |
| `sensitivity` | `string` | 否 | 不传时默认 `normal` |
| `owner_ref` | `string` | 否 | 不传时默认 `unknown` |
| `labels` | `string[]` | 否 | 标签列表 |
| `updated_at` | `string` | 否 | 不传时服务端自动补当前时间 |

成功响应示意：

```json
{
  "namespace": "tenant_a.kb",
  "created_count": 1,
  "updated_count": 0,
  "total_count": 1,
  "persistence_driver": "memory"
}
```

### 9.2 `GET /control/objects`

用途：分页查询对象台账。

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `namespace` | 是 | 工作区 |
| `object_type` | 否 | 按对象类型过滤 |
| `sensitivity` | 否 | 按敏感度过滤 |
| `limit` | 否 | 默认 `20`，范围 `[1,100]` |
| `offset` | 否 | 默认 `0` |

响应特征：

1. 返回 `items`、`total_count`、`has_more`、`next_offset`。  
2. 同时回显 `namespace`、`limit`、`offset`、`persistence_driver`。

### 9.3 `POST /control/relations:events`

用途：向某个 `namespace` 批量同步关系事件。

请求体：

```json
{
  "namespace": "tenant_a.kb",
  "events": [
    {
      "from": "user:alice",
      "to": "group:engineering",
      "relation_type": "member_of",
      "operation": "upsert",
      "scope": "default",
      "source": "scim",
      "occurred_at": "2026-03-09T10:00:00.000Z"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `from` | `string` | 是 | 边起点 |
| `to` | `string` | 是 | 边终点 |
| `relation_type` | `string` | 是 | 关系类型 |
| `operation` | `string` | 否 | `upsert` 或 `delete`，默认 `upsert` |
| `scope` | `string` | 否 | 关系作用域 |
| `source` | `string` | 否 | 来源系统 |
| `occurred_at` | `string` | 否 | 事件发生时间 |

成功响应示意：

```json
{
  "namespace": "tenant_a.kb",
  "upserted_count": 1,
  "deleted_count": 0,
  "total_count": 1,
  "persistence_driver": "memory"
}
```

### 9.4 `GET /control/relations`

用途：分页查询关系边。

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `namespace` | 是 | 工作区 |
| `relation_type` | 否 | 按关系类型过滤 |
| `from` | 否 | 按起点过滤 |
| `to` | 否 | 按终点过滤 |
| `limit` | 否 | 默认 `20` |
| `offset` | 否 | 默认 `0` |

### 9.5 `GET /control/audits`

用途：查询控制面写入审计。

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `namespace` | 否 | 按工作区过滤 |
| `event_type` | 否 | 按事件类型过滤 |
| `limit` | 否 | 默认 `20` |
| `offset` | 否 | 默认 `0` |

常见审计事件类型：

1. `control.object.upserted`  
2. `control.relation.synced`  
3. `control.model_route.upserted`

### 9.6 `POST /control/model-routes:upsert`

用途：把某个 `namespace + tenant_id + environment` 路由到一个已发布模型。

请求体：

```json
{
  "namespace": "tenant_a.kb",
  "routes": [
    {
      "tenant_id": "tenant_a",
      "environment": "prod",
      "model_id": "tenant_a_kb_acl",
      "model_version": "2026.03.09",
      "publish_id": "pub_20260309_001",
      "operator": "console_operator",
      "updated_at": "2026-03-09T10:00:00.000Z"
    }
  ]
}
```

路由约束：

1. `tenant_id`、`environment`、`model_id` 必填。  
2. `environment` 会被服务端归一化为小写。  
3. 如果传了 `publish_id`，它必须存在且状态为 `published`。  
4. 路由中的 `tenant_id/model_id/model_version` 必须与已发布快照一致，否则返回 `409 INVALID_ROUTE`。  
5. 如果不传 `publish_id`，服务端会尝试按 `model_id + model_version` 找已发布快照。

成功响应示意：

```json
{
  "namespace": "tenant_a.kb",
  "created_count": 1,
  "updated_count": 0,
  "total_count": 1,
  "items": [
    {
      "key": "tenant_a.kb::tenant_a::prod",
      "namespace": "tenant_a.kb",
      "tenant_id": "tenant_a",
      "environment": "prod",
      "model_id": "tenant_a_kb_acl",
      "model_version": "2026.03.09",
      "publish_id": "pub_20260309_001",
      "updated_at": "2026-03-09T10:00:00.000Z",
      "operator": "console_operator"
    }
  ],
  "persistence_driver": "memory"
}
```

### 9.7 `GET /control/model-routes`

用途：查询已配置路由。

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `namespace` | 否 | 按工作区过滤 |
| `tenant_id` | 否 | 按租户过滤 |
| `environment` | 否 | 按环境过滤，服务端会小写归一化 |
| `limit` | 否 | 默认 `20` |
| `offset` | 否 | 默认 `0` |

## 10. 发布流程接口

### 10.1 `POST /publish:gate-check`

用途：仅执行门禁检查，不创建正式发布工作流记录。

请求体：

```json
{
  "model": {
    "model_meta": {
      "model_id": "tenant_a_kb_acl",
      "tenant_id": "tenant_a",
      "version": "2026.03.09",
      "status": "draft"
    }
  },
  "profile": "baseline",
  "publish_id": "pub_preview_001",
  "metrics_override": {
    "coverage": {
      "action_coverage_ratio": 0.95
    }
  },
  "options": {
    "available_obligation_executors": ["audit_write"]
  }
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | `object` | 是 | 待发布模型 |
| `profile` | `string` | 否 | `baseline` 或 `strict_compliance` |
| `publish_id` | `string` | 否 | 若不传由门禁逻辑生成 |
| `metrics_override` | `object` | 否 | 用于覆盖门禁指标 |
| `options.available_obligation_executors` | `string[]` | 否 | 可用义务执行器 |
| `options.cardinality_counts` | `object` | 否 | 基数统计输入 |

响应特征：

1. 返回 `persisted_at`、`persistence_driver`。  
2. 同时返回门禁结果对象，例如 `publish_id`、`profile`、`final_result`、`metrics`、`publish_recommendation` 等。  
3. 门禁报告会落库，可通过 `GET /gate-reports/:id` 查询。

### 10.2 `GET /gate-reports/:id`

用途：查询单次门禁报告。

### 10.3 `POST /publish:simulate`

用途：对“草稿模型 vs 基线模型”做影响模拟，输出受影响主体、对象、动作和风险摘要。

请求体关键字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 草稿模型 |
| `profile` | 否 | `baseline` 或 `strict_compliance` |
| `publish_id` | 否 | 本次模拟对应的发布 ID |
| `baseline_model` | 否 | 显式传入基线模型 |
| `baseline_publish_id` | 否 | 或者指定一个已存在发布单作为基线 |
| `sample_subjects` | 否 | 模拟主体样本 |
| `sample_objects` | 否 | 模拟对象样本 |
| `actions` | 否 | 限定参与模拟的动作集合 |
| `top_n` | 否 | Top 结果截断数量 |

响应特征：

1. 返回 `report_id`、`generated_at`、`persisted_at`、`persistence_driver`。  
2. 返回 `summary`、`scenarios`、`top_impacted_subjects`、`top_impacted_objects`、`action_change_matrix`。  
3. 返回 `gate_result` 与可选的 `baseline_gate_result`。  
4. 模拟报告会落库。

### 10.4 `GET /publish/simulations`

用途：分页查询模拟报告。

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `publish_id` | 否 | 按发布单过滤 |
| `profile` | 否 | `baseline` 或 `strict_compliance` |
| `limit` | 否 | 默认 `20` |
| `offset` | 否 | 默认 `0` |

### 10.5 `GET /publish/simulations/:id`

用途：查询单个模拟报告详情。

响应特征：

1. 返回报告主体内容。  
2. 额外回显 `persisted_at` 与 `persistence_driver`。

### 10.6 `POST /publish/submit`

用途：提交发布流程。该接口会同时：

1. 跑一遍门禁。  
2. 生成并持久化发布单。  
3. 返回当前发布状态。

请求体：

```json
{
  "model": {
    "model_meta": {
      "model_id": "tenant_a_kb_acl",
      "tenant_id": "tenant_a",
      "version": "2026.03.09",
      "status": "draft"
    }
  },
  "profile": "baseline",
  "submitted_by": "release_bot",
  "options": {
    "available_obligation_executors": ["audit_write"]
  }
}
```

成功响应示意：

```json
{
  "publish_id": "pub_xxx",
  "status": "review_required",
  "persisted_at": "2026-03-09T10:00:00.000Z",
  "persistence_driver": "memory",
  "gate_result": {
    "publish_id": "pub_xxx",
    "profile": "baseline",
    "final_result": "review_required"
  }
}
```

状态说明：

| 状态 | 含义 |
| --- | --- |
| `blocked` | 门禁阻断，不允许继续激活 |
| `review_required` | 需要人工复核 |
| `approved` | 已复核通过，待激活 |
| `rejected` | 已驳回 |
| `published` | 已激活并生效 |

### 10.7 `GET /publish/requests`

用途：分页查询发布单。

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `status` | 否 | `blocked/review_required/approved/rejected/published` |
| `profile` | 否 | `baseline` 或 `strict_compliance` |
| `limit` | 否 | 默认 `20` |
| `offset` | 否 | 默认 `0` |

### 10.8 `GET /publish/requests/:id`

用途：查询某个发布单详情。

兼容路径：

1. `GET /publish:requests/:id` 与之等价。

### 10.9 `POST /publish/review`

用途：复核某个发布单。

请求体：

```json
{
  "publish_id": "pub_xxx",
  "decision": "approve",
  "reviewer": "security_reviewer",
  "reason": "gate result accepted",
  "expires_at": "2099-01-01T00:00:00.000Z"
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `publish_id` | 是 | 发布单 ID |
| `decision` | 是 | `approve` 或 `reject` |
| `reviewer` | 是 | 复核人 |
| `reason` | 是 | 复核原因 |
| `expires_at` | 否 | 复核有效期，必须是合法 ISO 时间 |

常见失败：

1. 发布单不存在时返回 `404 NOT_FOUND`。  
2. 当前状态不允许复核时返回 `409 INVALID_STATE`。

### 10.10 `POST /publish/activate`

用途：激活某个发布单，使之进入 `published` 状态。

请求体：

```json
{
  "publish_id": "pub_xxx",
  "operator": "release_bot"
}
```

常见失败：

1. 发布单不存在时返回 `404 NOT_FOUND`。  
2. 当前状态不允许激活时返回 `409 INVALID_STATE`。

## 11. 数据面判权接口

### 11.1 `POST /decisions:evaluate`

用途：对单个对象做四值决策。

请求模式有两种：

1. **直接传 `model`**：适合本地调试、一次性工具、测试。  
2. **传 `model_route`**：适合正式运行态，请求会先解析路由，再装载已发布模型。

#### 请求体示例：直接传 `model`

```json
{
  "model": {
    "model_meta": {
      "model_id": "tenant_a_kb_acl",
      "tenant_id": "tenant_a",
      "version": "2026.03.09",
      "status": "draft"
    }
  },
  "input": {
    "action": "read",
    "subject": {
      "id": "user:bob",
      "type": "user"
    },
    "object": {
      "id": "kb:doc_1001",
      "type": "kb",
      "sensitivity": "normal"
    },
    "context": {
      "request_time": "2026-03-09T10:00:00.000Z",
      "namespace": "tenant_a.kb"
    }
  },
  "options": {
    "strict_validation": true,
    "available_obligation_executors": ["audit_write"],
    "relation_inference": {
      "enabled": true,
      "namespace": "tenant_a.kb",
      "max_relations_scan": 500
    }
  }
}
```

#### 请求体示例：使用 `model_route`

```json
{
  "model_route": {
    "namespace": "tenant_a.kb",
    "tenant_id": "tenant_a",
    "environment": "prod"
  },
  "input": {
    "action": "read",
    "subject": {
      "id": "user:bob",
      "type": "user"
    },
    "object": {
      "id": "kb:doc_1001",
      "type": "kb"
    },
    "context": {
      "request_time": "2026-03-09T10:00:00.000Z"
    }
  }
}
```

请求字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 条件必填 | 与 `model_route` 二选一 |
| `model_route.namespace` | 使用路由时必填 | 工作区 |
| `model_route.tenant_id` | 使用路由时必填 | 租户 |
| `model_route.environment` | 使用路由时必填 | 环境 |
| `input.action` | 是 | 动作 |
| `input.subject.id` | 是 | 主体 ID |
| `input.object.id` | 是 | 对象 ID |
| `input.context` | 否 | 附加上下文 |
| `options.strict_validation` | 否 | 默认 `true` |
| `options.relation_inference.enabled` | 否 | 默认启用 |
| `options.relation_inference.namespace` | 否 | 显式指定关系推导工作区 |
| `options.relation_inference.max_relations_scan` | 否 | 限制关系扫描上限 |

成功响应示意：

```json
{
  "decision_id": "dec_xxx",
  "persisted_at": "2026-03-09T10:00:00.000Z",
  "persistence_driver": "memory",
  "resolved_model": {
    "model_id": "tenant_a_kb_acl",
    "tenant_id": "tenant_a",
    "version": "2026.03.09",
    "status": "published"
  },
  "resolved_route": {
    "key": "tenant_a.kb::tenant_a::prod",
    "namespace": "tenant_a.kb",
    "tenant_id": "tenant_a",
    "environment": "prod",
    "model_id": "tenant_a_kb_acl",
    "model_version": "2026.03.09",
    "publish_id": "pub_xxx"
  },
  "decision": {
    "final_effect": "allow",
    "reason": "matched allow rules",
    "matched_rules": ["rule_read_kb"],
    "overridden_rules": [],
    "obligations": [],
    "advice": []
  },
  "traces": [],
  "constraint_evaluation": {
    "violations": []
  },
  "model_validation": {
    "valid": true
  },
  "relation_inference": {
    "enabled": true,
    "applied": true,
    "namespace": "tenant_a.kb",
    "rules": []
  }
}
```

关键语义：

1. 如果只传 `model_route`，服务端会先查路由，再查已发布模型快照。  
2. 若路由存在，但其 `publish_id` 对应的发布单不是 `published`，请求会失败。  
3. 若 `strict_validation=true` 且模型校验不通过，返回 `422 INVALID_MODEL`。  
4. 若约束求值存在违规，返回 `409 CONSTRAINT_VIOLATION`。  
5. `relation_inference` 结果会告诉调用方是否启用、是否应用、以及失败原因。

### 11.2 `POST /decisions/search`

用途：查询某个主体对哪些对象具备 `allow` 权限。

关键语义：

1. 只返回 `allow` 对象。  
2. 结果页支持 `cursor` 分页。  
3. 当前实现采用“候选对象集合 + 页内逐对象精评估”的方式组织结果。  
4. 高风险动作在真正执行前仍应再次调用 `POST /decisions:evaluate`。

请求体示例：

```json
{
  "model_route": {
    "namespace": "tenant_a.kb",
    "tenant_id": "tenant_a",
    "environment": "prod"
  },
  "input": {
    "action": "read",
    "subject": {
      "id": "user:bob",
      "type": "user"
    },
    "context": {
      "request_time": "2026-03-09T10:00:00.000Z"
    }
  },
  "filters": {
    "object_ids": ["kb:doc_1001"],
    "object_type_in": ["kb"],
    "sensitivity_in": ["normal", "high"],
    "labels_all": ["project_alpha"],
    "updated_after": "2026-03-01T00:00:00.000Z"
  },
  "page": {
    "limit": 20,
    "cursor": null
  },
  "options": {
    "strict_validation": true,
    "include_plan": true,
    "include_trace_sample": false,
    "max_candidates_scan": 5000,
    "relation_inference": {
      "enabled": true,
      "namespace": "tenant_a.kb"
    }
  }
}
```

请求字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` / `model_route` | 条件必填 | 与 `evaluate` 相同，二选一 |
| `input.action` | 是 | 动作 |
| `input.subject.id` | 是 | 主体 ID |
| `filters.object_ids` | 否 | 限定对象 ID 集合 |
| `filters.object_type_in` | 否 | 对象类型过滤 |
| `filters.sensitivity_in` | 否 | 敏感度过滤 |
| `filters.labels_all` | 否 | 标签全包含过滤 |
| `filters.updated_after` | 否 | 按更新时间下界过滤 |
| `page.limit` | 否 | 默认 `20`，最大 `100` |
| `page.cursor` | 否 | 上一页返回的 `next_cursor` |
| `options.max_candidates_scan` | 否 | 默认 `2000`，最大 `20000` |
| `options.include_plan` | 否 | 是否返回执行计划 |
| `options.include_trace_sample` | 否 | 是否返回结果样本 trace |

成功响应示意：

```json
{
  "search_id": "dec_xxx",
  "persisted_at": "2026-03-09T10:00:00.000Z",
  "persistence_driver": "memory",
  "resolved_model": {
    "model_id": "tenant_a_kb_acl",
    "tenant_id": "tenant_a",
    "version": "2026.03.09",
    "status": "published"
  },
  "resolved_route": {
    "key": "tenant_a.kb::tenant_a::prod",
    "namespace": "tenant_a.kb",
    "tenant_id": "tenant_a",
    "environment": "prod",
    "model_id": "tenant_a_kb_acl",
    "model_version": "2026.03.09",
    "publish_id": "pub_xxx"
  },
  "page": {
    "limit": 20,
    "next_cursor": "MjA",
    "has_more": false,
    "total_count": 1,
    "truncated_by_max_scan": false
  },
  "items": [
    {
      "object_id": "kb:doc_1001",
      "object_type": "kb",
      "sensitivity": "normal",
      "labels": ["project_alpha"],
      "owner_ref": "user:alice",
      "updated_at": "2026-03-09T10:00:00.000Z",
      "decision_id": "dec_item_xxx",
      "final_effect": "allow",
      "reason": "matched allow rules",
      "matched_rules": ["rule_read_kb"],
      "overridden_rules": [],
      "obligations": [],
      "advice": []
    }
  ],
  "relation_inference": {
    "enabled": true,
    "namespace": "tenant_a.kb",
    "applied_count": 1,
    "failed_count": 0
  },
  "decision_stats": {
    "allow": 1,
    "deny": 0,
    "not_applicable": 0,
    "indeterminate": 0
  },
  "model_validation": {
    "valid": true
  },
  "constraint_evaluation": {
    "violations": []
  },
  "plan": {
    "mode": "pushdown_with_residual",
    "namespace": "tenant_a.kb",
    "pushdown_clauses": ["object.type in [kb]"],
    "residual_clauses": ["subject_selector + object_selector + conditions full evaluation in engine"],
    "scanned_count": 1,
    "candidate_count": 1,
    "allow_count": 1,
    "parse_error_rule_count": 0,
    "impossible_rule_count": 0,
    "active_allow_rule_count": 1,
    "truncated_by_max_scan": false
  }
}
```

常见失败：

1. `input.action` 或 `input.subject.id` 缺失时返回 `400 INVALID_REQUEST`。  
2. 未提供 `model` 且 `model_route` 无法解析时返回 `404 NOT_FOUND` 或 `400 INVALID_REQUEST`。  
3. 模型校验失败、约束违规时行为与 `evaluate` 相同。

### 11.3 `GET /decisions/:id`

用途：查询单次判权落库记录。

### 11.4 `GET /decisions`

用途：分页查询判权记录。

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `limit` | 否 | 默认 `20` |
| `offset` | 否 | 默认 `0` |

## 12. 生命周期高级接口

### 12.1 `POST /lifecycle:subject-removed`

用途：在某个主体被删除、离职或失效后，对对象归属和关系影响做生命周期处理。

请求体示例：

```json
{
  "model": {
    "model_meta": {
      "model_id": "tenant_a_kb_acl",
      "tenant_id": "tenant_a",
      "version": "2026.03.09",
      "status": "published"
    }
  },
  "event": {
    "target": "user:alice",
    "operator": "hr_sync",
    "occurred_at": "2026-03-09T10:00:00.000Z"
  },
  "relations": {
    "subject_relations": [],
    "object_relations": [],
    "subject_object_relations": []
  },
  "object_snapshots": [],
  "options": {
    "fallback_owner": "user:manager_1"
  }
}
```

响应特征：

1. 返回 `lifecycle_id`、`persisted_at`、`persistence_driver`。  
2. 返回生命周期求值结果对象。  
3. 结果会持久化，可通过 `GET /lifecycle-reports/:id` 读取。

### 12.2 `GET /lifecycle-reports/:id`

用途：查询生命周期处理报告。

## 13. 推荐接入流程（给大模型直接照着实现）

### 13.1 场景 A：本地快速验证一份模型

按顺序执行：

1. 调用 `POST /models:validate`。  
2. 若 `valid=false`，停止并修正模型。  
3. 调用 `POST /decisions:evaluate`，请求体里直接放 `model`。  
4. 若需要集合检索，再调用 `POST /decisions/search`。  
5. 不要在这个阶段引入 `publish`、`model_route`、`namespace` 同步逻辑，除非你正在验证控制面。

### 13.2 场景 B：第三方系统正式接入

按顺序执行：

1. 准备模型 JSON。  
2. 调用 `POST /publish/submit`。  
3. 若返回 `status=review_required`，调用 `POST /publish/review`。  
4. 调用 `POST /publish/activate`。  
5. 调用 `POST /control/model-routes:upsert`，把 `namespace + tenant_id + environment` 挂到已发布模型。  
6. 对象创建/变更时调用 `POST /control/objects:upsert`。  
7. 关系变化时调用 `POST /control/relations:events`。  
8. 业务读写前调用 `POST /decisions:evaluate`。  
9. 列表页、搜索页、候选资源发现类能力调用 `POST /decisions/search`。  
10. 高风险动作在最终执行前再做一次 `evaluate`。

### 13.3 场景 C：对象同步前做入管预检

按顺序执行：

1. 调用 `POST /objects:onboard-check`。  
2. 若 `accepted=false`，不要写入控制面。  
3. 若仅有 `warnings` 且你的接入策略允许，可继续同步对象。  
4. 真正写入时调用 `POST /control/objects:upsert`。

## 14. 大模型生成代码时的反模式

以下写法应明确避免：

1. **把 `tenant_id` 直接当成 `namespace` 使用**。  
2. **在生产请求里直接内嵌长篇 `model`**，导致模型版本漂移。  
3. **先拉全量对象，再对每个对象单独调用 `evaluate` 来模拟搜索**。这违背 `Decision Search` 设计目标。  
4. **拿 `Decision Search` 的结果直接执行高敏动作**，而不做最终 `evaluate`。  
5. **忽略 `409 CONSTRAINT_VIOLATION` 与 `422 INVALID_MODEL` 的区别**。前者是约束冲突，后者是模型本身校验失败。  
6. **把 `publish` 理解成“模型已经自动在所有环境生效”**。真正生效还需要 `model_route`。  
7. **重试失败请求时随意更改主键字段**，导致重复对象、重复关系或错误覆盖。

## 15. 对接 checklist

第三方系统进入联调前，至少确认以下事项：

1. 已明确 `tenant_id`。  
2. 已规划 `namespace`，并与其他系统隔离。  
3. 已统一 `object_type` 与 `action` 命名。  
4. 已确定使用哪种发布模式：仅测试直传 `model`，还是正式走 `publish + model_route`。  
5. 已确定对象同步频率和关系同步触发点。  
6. 已在调用链上明确哪些动作属于高风险，必须二次 `evaluate`。  
7. 已实现对 `400/404/409/422/500` 的分支处理。  
8. 已准备好请求/响应日志，方便按 `decision_id`、`publish_id`、`report_id` 回放。

## 16. 文档边界说明

本文档刻意不展开以下内容：

1. `model` 全量字段定义，请参考 [11_权限配置JSON_Schema草案.md](./11_权限配置JSON_Schema草案.md)。  
2. 发布门禁阈值与示例，请参考 [12_权限发布门禁规则样例.md](./12_权限发布门禁规则样例.md)。  
3. 设计原理、语义推导与接入模式背景，请参考 [10_企业可配置权限模型开发设计.md](./10_企业可配置权限模型开发设计.md)。

如果第三方团队是“人类研发 + 大模型协作编码”，推荐阅读顺序如下：

1. 先读 `docs/10` 的 `10.4 外部应用接入模型`。  
2. 再读本文档的第 3、4、9、10、11 章。  
3. 写模型时再回到 `docs/11`。  
4. 上线前联调门禁与模拟时再读 `docs/12`。
