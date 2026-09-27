# 人工核对后的账号登录确认恢复

关联 #468、总验收 #32。基线 `8766aaef3ce67ccb29823294119796b1a9971bcd`。

## 缺陷与修复边界

`confirm-login` 拒绝所有历史 `unknown` 浏览器运行，而文字和视频人工核对流程有意保留原始 unknown 回执与运行状态。因此，即使业务结果已经核对，账号所有者仍不能确认登录。已在独立合成 PostgreSQL 中通过真实 broker 和人工核对函数复现，未修改生产记录。

修复只在节点锁内核对完整链路：同节点、运行、任务、账号与渠道；已成功的业务任务和已发布记录；相同外部结果；原授权及 unknown 回执；原节点所有者的人工核对审计、内容对象、任务与载荷摘要；原始载荷摘要仍一致。所有未知运行均须满足条件。实时运行、未核对结果及错配链路仍拒绝。

显式登录确认只更新账号就绪状态。原 unknown 运行/回执、渠道暂停与发布幂等记录保持不变，不创建新发布授权、不重发。当前页面审核、网络策略和逐帖授权仍是独立验收条件。

## WSL Podman 验证

- 应用工具镜像 `sha256:7f9ac8fb9baf9ee53c4520732c338112faa99734fafb16af7fc4e9b132f2100b`，Node 24.21.0，复用锁定依赖；待验工作树只读挂载 `/work`。未修改锁文件或用户工作区的 pnpm 配置。
- PostgreSQL 17 镜像 `sha256:248efd5e58cd743f2a0e0daec8ea4649e5580145ec2a12e2345bc710d4a77201`；专用临时容器，仅监听 `127.0.0.1:55468`，数据库 `facebook_publication_test`。无生产环境文件或凭据挂载。
- 测试容器 2 CPU / 3 GiB，挂载本机 Chromium 缓存；完整 `node --conditions=react-server --import tsx scripts/test-facebook-publication-postgres.ts` 通过。覆盖文字/视频人工核对后恢复、未核对拒绝、账号/运行错配、业务结果回退、载荷篡改、额外实时或未知运行、无效会话、3 路并发确认，以及渠道/回执/运行不变。现有独立权限、收件箱、登录凭据与发布回执回归同时通过。
- 首次新增正向回归在未修复代码上以 `resolve_running_or_unknown_result_first` 失败。
- 初版负面测试试图更新审计行，被数据库 append-only 保护拒绝；保留失败日志，改成断言不可变保护并测试可变业务链的错配，未禁用任何数据库约束。
- TypeScript 7 对测试内局部运行引用出现 TS7022；添加明确的 `Run | undefined` 类型后复验。Biome 仅报告三个原有警告。

原始日志保存在本机 `/tmp/ftrade-login-recovery-20260927/`；GitHub 仅保存脱敏说明及哈希。

| 日志 | SHA-256 |
| --- | --- |
| 首次产品失败 `baseline.log` | `b5e0bf18481c3e974074f5b3f90a947f3553758f569c1e79bcbf1f46be9d3cbc` |
| 测试设计失败 `fixed-full.log` | `6bfdbdc14907c5e5475dfa854434e292bd9e60c7d4bd42b14cc6f04fcd96f1a4` |
| 完整回归通过 `fixed-regression.log` | `32c15fa50b4d37e84db0c6f5c291c57d84afa8c3a0ed95499883074968d0e01a` |

本项证明恢复逻辑，不证明生产账号当前登录、在线出口或视频自动回执。六项正式验收状态不因此变更。
