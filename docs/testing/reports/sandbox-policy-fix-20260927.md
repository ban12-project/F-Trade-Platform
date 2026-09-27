# #459 策略校验候选修复

基线 `main@37c068363aea3e746119b56a01f7757dfca63fbd`。本候选必须先完成已审核策略配置与真实 SDK 返回值核对，再合并部署；不代表生产网络或在线账号验收通过。

原缺陷在 `6286070` 使用 WSL Podman 合成 provider 连续复现：缺失、allow-all、deny-all 元数据都恢复实例，创建没有显式策略。首次与第二次失败日志 SHA-256 均为 `bb7e7c4721b006bf09d1b289e203a503f8b87eef4a5ce4f4ad9ba7696f56f11a`，保留于本地 `/tmp/ftrade-policy-repro-20260927/`。

修复从服务端私有 `BROWSER_SANDBOX_NETWORK_POLICY_JSON` 读取明确策略；未配置或无效时在领取启动操作前拒绝。创建显式传策略，恢复在 `resume:false` 检查时比对策略，创建/恢复返回后再次检查。对象键序规范化，数组及规则/转换顺序保留；不能推断未知策略，不能静默修改策略。已有会话恢复监控、停止与不确定操作对账不要求此新配置。策略配置错误只返回稳定错误码，不含私有 URL 或 header。

WSL Podman 既有 eval 镜像、Node 24.21.0 / pnpm 12.3.4，禁网合成测试：provider/controller 22/22，连同 session/runtime/monitor/recovery/dispatch-route 共 56/56。完整 TypeScript 检查通过。原有 CI browser-node 工作流已包含这些回归入口；不需要新增并行测试入口。未修改依赖或锁文件，未启动生产实例、领取账号凭据或更改生产策略。

复验输出保存在 `/tmp/ftrade-policy-fix-20260927/`。真实模板测试显式使用 deny-all，仅适用于无账号的离线合成烟测。现有 SDK 对原实例返回策略缺失，候选会拒绝其恢复；不能把这种拒绝算作在线业务恢复通过。草稿须保留到实际策略可观察且配置迁移、回滚步骤获核对，否则部署会让既有自动唤醒因配置缺失而拒绝启动。#459 保持开放。
