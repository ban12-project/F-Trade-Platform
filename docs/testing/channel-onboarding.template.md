# MVP1 Facebook CamoFox 渠道接入清单模板

此清单用于在**受控内部系统**确认首个社媒渠道是否可进入测试。GitHub 只能保存脱敏引用和聚合状态；禁止保存账号名、密码、Cookie、OAuth token、2FA/recovery code、浏览器 profile、客户消息或截图原件。

## 使用边界

- 传输固定为 `camofox_controlled_mvp1`，仅限一个获授权的 Facebook Personal Profile。
- 不使用 Cookie 重放、代理池、自动换号、自动登录恢复或 CAPTCHA 服务；首次登录由账户本人经受控 VNC 完成。
- MVP 只接收用户主动发起的入站消息；冷启动私信不在范围内。
- 任何发布、回复、报价或交期等外部副作用都需要对应的人工批准；报价和交期仍需 Gate 02 / Gate 03。

## 填写字段

| 字段 | 填写规则 |
| --- | --- |
| `channel_ref` / `account_ref` | 使用私有系统生成的 `sanitized-*` 或 `evidence-*` 引用，不写账号名或 URL。 |
| `platform` / `account_type` | MVP1 固定为 `facebook` / `personal_profile`。 |
| `ownership_status` | 仅在工厂确认管理员、2FA 和恢复责任后标记 `verified`。 |
| `official_oauth_status` | CamoFox 路径为 `not_started`；不得借此声称拥有官方 API 资格。 |
| `browser_automation_mode` | 必须为 `camofox_controlled_mvp1`；固定出口、账户本人登录和熔断手册均须有脱敏证据引用。 |
| `reply_window_*` | 仅填由渠道规则和人工确认的窗口；Agent 不得猜测。 |
| `evidence_refs` | 只记录私有授权、资格或测试证据的脱敏引用。 |
| `production_readiness` | 初始值为 `not_ready`；只有受控真实验收完成后才可 `test_ready`。 |

## 操作顺序

1. 在 [#11](https://github.com/ban12-project/F-Trade-Platform/issues/11) 选择唯一首发渠道和工厂账号责任人。
2. 在私有系统确认账户本人、2FA、恢复责任、固定美国出口 IP 和人工接管责任。
3. 在隔离 VPS 由账户本人完成首次登录；浏览器状态只能存在加密运行卷。
4. 用 synthetic 批准内容测试发布；由独立测试者主动发送 DM，并确认观察带 `observation_ref`、身份质量和去重结果。
5. 确认窗口外回复被阻断；安全检查、登录失效、IP 不符和页面不确定都会熔断。
6. 只有所有证据齐全时，才将清单传递给 `ChannelInboundPolicy` 与 `ContentPublicationPolicy` 的人工启用流程。

## 契约

使用 `contracts/social/channel-onboarding.schema.json` 验证结构。该契约刻意拒绝额外字段，因此密码、token、Cookie 等敏感数据不能被记录。
