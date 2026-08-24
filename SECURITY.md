# 安全与数据分级

## 仓库定位

本仓库为私有研发仓库。私有不等于可随意上传敏感数据；Git 历史、Issue、PR、Actions 日志和本地克隆都可能扩大数据暴露面。

## 禁止提交

- API keys、密码、token、私钥和 `.env` 文件。
- 浏览器 profile、Cookie、storage state、`auth.json`、HAR、CDP 连接信息或其他可复用登录状态。
- 真实客户姓名、公司、邮箱、电话、聊天记录和目的港。
- 真实报价、成本、底价、利润率和未公开交期。
- 未确认的 OE、车型适配、尺寸、认证和安全性能。
- 未取得归档授权的工厂原始资料。

## 可提交内容

- 已确认且允许用于研发的产品契约和字段模板。
- 脱敏或明确标记为 synthetic 的测试 fixture。
- 需求、决策、架构、验收和流程文档。
- 仅作为格式参考且明确隔离的资料。

发现疑似泄露时，不要在 Issue 或 PR 中复制秘密；先停止传播、撤销凭据，并通知仓库管理员。

## 浏览器自动化测试边界

- 不使用浏览器会话自动化作为生产社媒发布或 DM 传输通道；生产集成只能使用渠道官方 OAuth/API。
- 本地浏览器测试只能使用 synthetic 或专用测试账号，任何外部副作用都需要人工批准。
- `.gitignore` 和 `repository-validate` 会拒绝常见的 session state、Cookie、HAR 和 profile 路径；即使文件被强制加入也不能绕过校验。
- 发现浏览器状态泄露时，立即撤销会话并重置相关凭据；不要把泄露文件或其内容贴入 Issue、PR、日志或聊天。

## 认证与数据库

- `DATABASE_URL`、`BETTER_AUTH_SECRET`、`BLOB_READ_WRITE_TOKEN` 和生产 URL 只通过部署环境的 Secret 管理提供；Vercel 上优先使用平台 OIDC 短期凭据。
- 公开注册必须保持关闭；内部账号由已授权管理员创建，不在仓库保存初始密码。
- 邀请表只保存 token hash，不保存可直接使用的邀请 token。
- `audit_event` 与 `workflow_event` 是 append-only 表；数据库迁移通过触发器拒绝更新和删除。
- 数据库迁移属于外部状态变更，执行前必须确认目标环境，不对未知 URL 自动运行。
- 工程资料只写入 Private Blob；应用接口不得直接返回 private Blob URL 或读写 token。
- 模型输出即使通过结构校验也不等于事实已验证，发布前必须完成 Gate 01。
