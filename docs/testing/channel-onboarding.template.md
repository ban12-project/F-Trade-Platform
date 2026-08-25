# 官方渠道接入清单模板

此清单用于在**受控内部系统**确认首个社媒渠道是否可进入测试。GitHub 只能保存脱敏引用和聚合状态；禁止保存账号名、密码、Cookie、OAuth token、2FA/recovery code、浏览器 profile、客户消息或截图原件。

## 使用边界

- 仅使用官方 OAuth/API：发布由 Postiz 官方 API 路径完成，入站消息由 Chatwoot 官方 webhook 路径接收。
- 不使用浏览器自动化、Cookie 重放、模拟登录、代理池或 CAPTCHA 服务控制真实账号。
- MVP 只接收用户主动发起的入站消息；冷启动私信不在范围内。
- 任何发布、回复、报价或交期等外部副作用都需要对应的人工批准；报价和交期仍需 Gate 02 / Gate 03。

## 填写字段

| 字段 | 填写规则 |
| --- | --- |
| `channel_ref` / `account_ref` | 使用私有系统生成的 `sanitized-*` 或 `evidence-*` 引用，不写账号名或 URL。 |
| `platform` / `account_type` | 记录平台和官方 API 所需的账号类型；账号认证/蓝标不是默认要求。 |
| `ownership_status` | 仅在工厂确认管理员、2FA 和恢复责任后标记 `verified`。 |
| `official_oauth_status` | `tested` 表示对测试账号的官方 OAuth/API 测试已完成，不代表生产已批准。 |
| `reply_window_*` | 仅填由渠道规则和人工确认的窗口；Agent 不得猜测。 |
| `evidence_refs` | 只记录私有授权、资格或测试证据的脱敏引用。 |
| `production_readiness` | 初始值为 `not_ready`；全部官方路径测试后才可 `test_ready`。 |

## 操作顺序

1. 在 [#11](https://github.com/ban12-project/F-Trade-Platform/issues/11) 选择唯一首发渠道和工厂账号责任人。
2. 依据 [#49](https://github.com/ban12-project/F-Trade-Platform/issues/49) 在私有系统确认账号类型、公司资料、管理员与官方 API 资格。
3. 使用专用测试账号完成官方 OAuth/API 连接；凭据仅保存在已批准的 secret manager。
4. 用 synthetic 批准内容测试 Postiz 发布；由独立测试者主动发送 DM，并确认 Chatwoot webhook 只接收一次。
5. 确认窗口外回复被阻断或要求人工批准模板；不得把 DOM 观察当作消息收据。
6. 只有所有证据齐全时，才将清单传递给 `ChannelInboundPolicy` 与 `ContentPublicationPolicy` 的人工启用流程。

## 契约

使用 `contracts/social/channel-onboarding.schema.json` 验证结构。该契约刻意拒绝额外字段，因此密码、token、Cookie 等敏感数据不能被记录。
