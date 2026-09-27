# WSL Podman 本地验收 — 2026-09-27

关联 #454 / #392 / #32。先在本地 Podman 验证，再推送报告 PR 走 CI/CD。以下只证明合成容器链路，不证明真实模型质量、Facebook 自动回执或正式业务验收。

## 基线与执行环境

- 源码为 `main@241bec2cb29f396e6bee07994cdcaafd0dc50100`；通过 `git archive` 导出已跟踪的构建所需文件，未包含 `.env.local`。用户工作区的 pnpm 12.6.0 修改保留，未用于本次基线构建、未纳入报告提交。
- WSL2 Ubuntu 24.04，Podman 4.9.3 rootless，systemd cgroup v2，overlay；系统 newuidmap/newgidmap 已具备正确权限和 subuid/subgid。此前临时解包 helper 的 UID 映射失败已解除。
- Ubuntu Compose 2.40.3 解包至 `/tmp`，通过本次独立 Unix socket 连接 Podman；`podman compose ls` 成功。未修改系统服务配置。
- Harbor 按仓库约束安装 0.23.0 到临时虚拟环境。镜像采用仓库现有 Dockerfile，Node 24.21.0、pnpm 12.3.4、frozen lockfile。未关闭供应链检查或改锁文件。
- 本地合成评测镜像 ID：`sha256:4e78c6fe6e8df18a1de947814e442ac3ac4943d65c09d4320152973cde1cd0b3`。它不是 #453 的最终浏览器镜像，不替代同镜像验收。

## 结果与失败保留

| 条件 | 本轮观察 | 结果 |
| --- | --- | --- |
| Harbor 0.23.0 任务契约和适配器 | 20 项 schema、四供应商、缺凭据及非零退出检查 | 通过 |
| 首次契约检查 | 数据集生成到本轮子目录，检查脚本默认读另一固定目录，count 断言失败 | 已保留失败；按默认路径重新生成后通过 |
| 20×3 配置 | Podman dry-run 明确显示 60 trials，未执行模型 | 配置通过；模型验收未执行 |
| 实际 Podman oracle | 2 个容器任务，无执行异常；产物断言通过 | 通过 |
| 实际适配器／CLI | 2 个本地模拟 provider 容器任务：完整输入 reward 1，伪造 OE reward 0，均符合测试预期 | 通过；不代表模型得分 100% |
| 容器资源限制 | 禁网容器内读取 `pids.max=64`、`memory.max=268435456` | 本地限额生效；不证明浏览器内媒体进程额度足够 |
| #453 精确 GHCR 镜像 | 首次 unauthorized；用户完成 Podman 登录后同一摘要拉取成功 | 本地镜像读取阻塞解除 |
| 同镜像 H.264 解码 | 禁网下读到生成蓝色视频的正确尺寸和像素 | 通过；不证明 Facebook 页面播放或 AAC |
| 同镜像解码资源 | PID 峰值 165/512，内存峰值 425230336/2147483648 字节；PID max、memory max、OOM/OOM kill 事件均为 0 | 本轮合成解码通过；不外推真实多标签峰值 |
| 同镜像合成 profile | API 跨任务读写、另一账号拒绝、容器替换后回读、到期租约停止、正常停止退出码 0 | 通过；未使用真实账号 profile |

原始构建日志包含一次 npm tarball 超时后的自动重试，最终构建成功。结果索引见 [JSON](wsl-podman-acceptance-20260927.results.json)，原始日志保存在 `/tmp/ftrade-acceptance-20260927/logs/`。现有 smoke 脚本在成功断言后自动删除临时任务产物；本轮保留控制台输出及哈希，不声称另存了完整 trial JSON。

回收四个合成任务容器时，Podman 在 SIGTERM 等待 10 秒后使用 SIGKILL，最终容器列表为空；临时 API 服务已停止。这些容器没有业务会话，不能据此推断浏览器优雅退出或 profile 恢复通过。

## 新可用访问与剩余边界

浏览器请求摘要为 `sha256:60dee95faafbcd77c1b25dfe412e7b5810699f29ee4a62214ed2f48d38d69aff`，本地 image/config ID 为 `sha256:0cc22e02fe7a1542036a47b6fc64d84027747cd6eebdabe0192f773cbda42e1f`，revision 标签为 `b29c3e64bf7f851313279179c4905d114fbfcc4d`，amd64、native-profile 标记为 1。不是从主分支重新构建后替代该镜像。

解码和连续性采用仓库的 Podman 命名空间收紧策略，2 GiB 内存、2 CPU、512 PID、256 MiB shared memory、只读根目录、禁网、drop ALL capabilities、no-new-privileges。策略生成与回归通过，未关闭 Firefox sandbox。连续性脚本通过临时 `docker`→`podman` 转发器运行，只使用自己的合成卷；最终容器与卷列表为空。实际 Sandbox 的 Docker 策略、固定代理出口、真实身份和当前私有页面契约仍需单独同镜像验证。

Vercel CLI 已登录并取得该项目 OIDC。只读 API 确认生产部署 Ready、Git SHA 为本次基线、Node 24.x；Sandbox 列表完整返回 7 个停止实例。没有启动、修改或迁移生产 Sandbox，没有读取或释放 Facebook 凭据，也没有真实发帖或 DM。项目登录不能代替逐帖授权。

因此旧报告中的“本地 Podman 不可运行”“无 Sandbox 查询身份”和“GHCR 镜像读取未授权”已有新证据取代；实际 Sandbox 同镜像验证、当前 profile 审核、真实模型批次、独立入站发送者、工厂资料授权、实机与人工业务门禁仍待完成。#392 的本地 Harbor 合成容器连通性已验证，新的真实 20×3 模型验收仍未完成，Issue 不能关闭。原有正式业务摘要继续 `pending`，本报告不改变其六项状态。
