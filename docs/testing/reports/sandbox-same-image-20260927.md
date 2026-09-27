# 隔离 Sandbox 同镜像验收 — 2026-09-27

关联 #454 / #459 / #383 / #414 / #32。源码基线 `0a9fc494a3025e50acc917399c40c528d46c67d4`，前置证据为 [WSL Podman 验收](wsl-podman-acceptance-20260927.md)。本轮只推进运行时验收，不将离线恢复计为 Facebook 在线身份、视频自动回执或 DM 采集通过。

## 授权、隔离与回滚

用户明确授权建立包含现有账号 profile 的副本，并允许必要联网验证。此前自动审批拒绝发生在该明确授权之前，未执行复制；本轮授权后才创建副本。

只读数据库事务确认 managed node 与 Sandbox 对应、停止状态、无当前 session/operation、无 queued/starting/running/stopping/quarantined run。未修改生产业务记录。

从停止的原实例建立独立回滚副本，显式 `deny-all`、无开放端口、空环境覆盖，确认停止且有快照，保留期 7 天。第一次 stop 返回时尚未完成停止；随后以 `resume:false` 检查确认停止。再从该备份建立独立验收副本，显式 `deny-all`。没有把账号 profile 制成可复用模板。原实例不参与启动或测试。

验收副本运行 Docker 29.1.3，开始时无运行容器、只有一个既有账号卷，原容器 restart policy 为 `no`。沿用仓库 cgroup 准备脚本，实际 Docker 测试使用默认 seccomp；没有将 Podman 本地策略套用到 Docker，也没有关闭 Firefox sandbox。

## 产物追溯

- GHCR OCI 索引：`sha256:60dee95faafbcd77c1b25dfe412e7b5810699f29ee4a62214ed2f48d38d69aff`。
- WSL Podman 已验证的 browser image/config ID：`sha256:0cc22e02fe7a1542036a47b6fc64d84027747cd6eebdabe0192f773cbda42e1f`。
- revision：`b29c3e64bf7f851313279179c4905d114fbfcc4d`，amd64。

初次按 Podman config ID 查询 Docker 未命中；单凭这一查询不能判断镜像是否存在。将本地已验收镜像导出为 Docker archive，经 gzip、16 MiB 分块和 SDK 控制通道传输；没有传输 GHCR 凭据。首次 archive 校验成功，但 Docker legacy archive 导入未保留目标 config 摘要；该次结果不计通过。第一次 OCI 重封装又因误用压缩层摘要映射未压缩 tar 而失败。保留两次失败后，按原 config 的 28 个 diff ID 重封装 OCI layout，Docker 校验导入成功；未重新构建或更改配置、层内容。

Docker 29 的本次 containerd image store 返回的是 manifest 身份，不能与 Podman config ID 直接等同。最终本地 manifest/image ID 为 `sha256:d11c92125b355a5003d401f02f8f9cb2b467451954e1a8d97438db8bf742b75a`，其 config 内容摘要仍精确等于上述 `0cc22…`，RootFS 的 28 个 diff ID 与原 config 顺序一致，架构和 revision 一致。压缩方式与 archive/manifest 摘要不同须分列，不能冒充原 GHCR OCI 索引。

## 当前外部依赖

私有配置的正确契约为 login entry 嵌套 `profile`、publication entry 为平铺对象。首次读取 publication 时层级错误，未得到有效期限；修正只读检查后，publication profile 在检查时未过期，login observe-only 审核已于 2026-09-24 到期，inbox profile 不存在。保留首次不完整观察，不将它记为产品缺陷。

首次仅比较生产 Docker image ID 与 Podman config ID，不足以判断构建差异。随后沿生产设置对应的 manifest→config 链重新验证：生产配置指向 revision `5769f1f0f8c9bd5fb1182787e50f12108bdd6a02`、config `sha256:ddeb474f5b1e11219771960b7488d81032d8963b3755702de530c34cab7e1710`，确与本轮目标不同。这证明尚未协调接入，不说明旧镜像必然损坏。原实例 API 元数据没有给出 network policy，因此其有效出口策略仍未知；新副本的显式 deny-all 不补全原实例的证据。#459 保持开放。

本地没有 `FACEBOOK_CREDENTIAL_ACTIVE_KEY_ID` / `FACEBOOK_CREDENTIAL_KEYS_JSON`，无法使用数据库中加密的固定代理配置进行在线验证。未采用直接出口，也未获取登录因子。联网授权没有替代 profile 审核、逐帖确认、受众授权或独立 DM 发送者。

生产接入仍须先确认原实例有效网络策略，复核当前页面审核与固定出口，再按 [部署手册](../mvp1-managed-sandbox-rollout.md) 协调 Agent/browser 本地 image ID、持久启动脚本和应用配置。回滚使用独立停止备份及原配置；原生 profile 不重新执行 legacy 初始化。任何 unknown 发布记录保持原样，不自动重发。

## 本轮执行结果

| 条件 | 观察 | 判定 |
| --- | --- | --- |
| 原始镜像配置与文件系统 | OCI 导入后 config 摘要、28 层 diff ID、revision、amd64 均一致 | 通过；压缩封装摘要单列 |
| 实际 Docker H.264 解码 | 仓库 `verify-h264.mjs` 读到蓝色帧的尺寸及像素 | 通过；不证明 AAC 或 Facebook 页面播放 |
| 2 GiB / 2 CPU / 512 PID / 256 MiB shm | PID 峰值 150，内存峰值 836116480 字节；pids max、memory max、OOM/OOM kill 事件均为 0 | 本次解码通过，不外推真实多标签峰值 |
| 合成 profile 连续性 | 仓库 `test-native-profile-runtime.sh`：API 跨任务、另一账号拒绝、容器替换、租约到期停止及退出码 0 | 通过 |
| 既有账号副本归属 | 私有 owner 的 node/account 与只读 broker 结果一致，broker 无活动租约 | 通过 |
| 既有账号副本离线恢复 | 两轮禁网空页启动、正常退出 0、容器替换；原持久 cookie 集合保持一致 | 通过；不证明线上 cookie 仍被 Facebook 接受 |
| 登录身份、固定代理出口、当前页面 ready | 登录观察审核过期；本地缺固定代理密钥配置 | 外部阻塞，未执行 |
| 视频自动回执、DM→RFQ | 无本轮逐帖发布任务；无当前 inbox profile 和独立发送者 | 未执行，不关闭 #383 或入站验收 |

账号副本第一次测试显式传入 `about:blank` 被 `/tabs` 的 URL 校验拒绝，失败已保留；改用仓库已有的省略 URL 创建空页契约后，以首次持久 cookie 基线复验通过。没有为了测试放宽应用校验，也没有把这次测试入参问题登记为产品缺陷。

原始输出与操作元数据仅留在本机临时目录，GitHub 只保存脱敏结果和日志摘要。持久 cookie 值及其比较指纹均留在隔离副本内，没有输出到聊天或报告。凭据领取次数 **0**，登录因子提交 **0**，发布 **0**，DM 发送 **0**。完整结果索引见 [JSON](sandbox-same-image-20260927.results.json)。

正式六项业务摘要继续使用 [既有聚合摘要](mvp1-acceptance-20260926.summary.json)，六项 `not_run`、决策 `pending`，已在 WSL Podman 中用现有校验器通过。六类依赖中，容器运行、数据库只读和副本授权已解除；当前在线账号/出口审核、真实工厂资料、独立 DM 发送者、真实模型批次、实机及人工业务门禁仍未全部解除，不以离线结果作人工 Go。

同名验收 Sandbox 停止并完成快照后，以 `resume:false` 确认停止，再显式恢复。Docker 重启时运行容器数仍为 0，已验证镜像可用。第三轮账号副本空页启动通过，退出码 0，持久 cookie 集合与首次基线仍一致；因此 **离线跨 Sandbox 重启恢复通过**。它没有验证 Messenger 历史、账号在线 ready 或原生产实例的代理策略。

## 回收与交付状态

最终停止时快照仍在处理，首次删除被 `verification_not_stopped` 断言拒绝；待只读检查明确为 stopped 后，临时验收副本及其独有快照已删除。独立 deny-all 回滚备份保持停止，配置保留 7 天；原实例保持停止且快照未变。后置只读数据库检查仍为零活动/排队租约、无 session、无未解决 operation。

#383、#414 和 #459 只能获得本报告限定范围的补充证据，未满足全部关闭条件。#32 仍为 pending，由人工负责人在正式六项验收及外部依赖均满足后决定 Go/No-Go。
