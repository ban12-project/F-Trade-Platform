# M2 数据库恢复后的保留期演练 — 2026-10-15

接续原 [#122](https://github.com/ban12-project/F-Trade-Platform/issues/122) 和 [Neon 配置检查点](m2-neon-retention-checkpoint-20261010.md)。本次补齐应用在真实 PostgreSQL 备份／恢复后的本地行为证据；没有恢复生产数据库，也没有访问真实账号、修改真实资料时间或改变渠道暂停状态。

## 范围、隔离与回退

[演练脚本](../../../scripts/test-video-retention-restore.mts) 自行创建一个随机名称的 PostgreSQL 17 容器，仅绑定随机 loopback 端口，使用临时数据库目录。脚本不接受外部数据库地址或既有恢复目标，覆盖进程内数据库连接为该合成实例；应用 `fetch` 被拒绝。容器不挂载工作区、生产配置或账号卷。

迁移后创建四个合成视频：未到期、过期草稿、过期待审核和过期已批准。另有两个过期工作对象、原始来源、仅在非视频历史审计中引用的来源、一个待处理视频任务及一个 unknown 发布／暂停任务记录。工作对象采用明确标记的合成本地文件；删除适配器只允许访问本次登记的文件。它不是 Vercel Blob 的删除回执。

使用容器内实际 `pg_dump --format=custom` 保存两个检查点，分别 `createdb` 后用 `pg_restore --exit-on-error` 恢复到不同空数据库：

| 检查点 | 备份时状态 | 恢复时对象存储状态 |
| --- | --- | --- |
| 清理前 | 原完整视频内容、原始创建时间、未登记清理任务 | 源库已完成删除；工作文件已不存在 |
| 清理中断 | 视频已清理，一个文件删除成功但确认丢失；对应队列 pending、attempts=1 | 源库随后完成重试；工作文件已不存在 |

中断检查点还包含一个 1.0.0 历史政策版本的 pending 任务，用于证明恢复与重试不覆盖原政策。所有跨期时间仅赋予合成数据，且在备份前固定；恢复后不续期。回退方式为关闭数据库连接、移除本次容器及其卷、删除合成文件目录，成功及失败都走清理路径。不修改既有容器、数据库或镜像。

## 本地结果

执行环境为 Node.js 24.21.0、pnpm 12.3.4、Podman 的 `podman-machine-default-root` 连接。首次 Docker Hub 拉取遇到连接 EOF，改用 `public.ecr.aws/docker/library/postgres:17`；实际服务器为 PostgreSQL 17.11，镜像架构 amd64，配置摘要 `327daa8fae7178d61f93142f146b098467b345e10997b9eb79f63bd58e5c8f3c`，清单摘要 `3cec7eb015ba8adb28139fa5c83b8489cdf0e666e53dfdf20f598ae0cc8739e3`。CI 使用 Docker Hub 的 PostgreSQL 17 标签，各环境独立执行恢复，不把标签视为相同镜像字节的证明。

两次恢复均通过以下检查：

- 恢复后十一组相关表记录逐项等于相应备份检查点，所有原始到期锚点保持不变。
- 到期视频读取、工作台读取、编辑、处理入队、审核和新发布资格检查均拒绝；拒绝操作前后数据库快照完全一致。未到期的对照视频仍可读取。
- 清理前备份重新清理三个视频和两个工作对象；中断备份只重试一个 pending 对象。已不存在的合成文件删除可重试，队列完成后清除私有路径，资产／证据变为退休标记且大小为零。
- 原 1.0.0 任务保留政策、原始创建时间及任务标识，尝试数从 1 增至 2。再次运行清理返回全零，删除调用数和完整数据库快照不变。
- 原始来源、历史审计引用的来源字节与记录、产品与未到期视频、历史工作流／审计保持完整。unknown 发布继续 unknown，浏览器任务继续 paused，没有生成重试任务。
- 过期视频的处理任务标记 `RETENTION_EXPIRED`，审核自由文本被移除；每个过期视频只新增一条清理审计。

测试开发中保留两类失败：初版就绪探测误读初始化期间的 socket-only PostgreSQL，已改为检查 TCP；初版将已清理记录的编辑拒绝也限定为专用到期错误，实际先触发 Zod 的简化载荷校验。最终断言对完整记录要求 `VideoRetentionError`，对已清理记录仅允许到期或 Zod 校验错误，并检查零写入，未放宽应用门禁。最终测试完成后，本次标签下剩余容器为零。

复现命令：

```sh
CONTAINER_ENGINE=podman \
FTRADE_PODMAN_CONNECTION=podman-machine-default-root \
VIDEO_RETENTION_POSTGRES_IMAGE=public.ecr.aws/docker/library/postgres:17 \
node --conditions=react-server --import tsx scripts/test-video-retention-restore.mts
```

Docker 环境可直接运行最后一行。脚本接入现有 `product-stream-postgres` CI；本地 TypeScript 和改动文件 Biome 校验通过，最终提交 CI 状态以关联 PR 为准。

## 验收边界

本次证明的是：当前应用面对恢复的合成数据库记录，仍按原始时间拒绝过期使用、恢复清理、保护原始来源及历史状态。它不证明 Neon PITR 控制面恢复已执行、生产 Blob 真实删除、历史备份字节物理清除或其他供应商副本期限。因此原 #122 保持开放；生产没有真实到期对象时，继续不改写时间制造验收数据。

网关日志仍按政策 1.1.0 排除于本次 M2 验收。Facebook 真人验证及真实账号验收依用户决定保持暂停，MVP1 总验收未完成。
