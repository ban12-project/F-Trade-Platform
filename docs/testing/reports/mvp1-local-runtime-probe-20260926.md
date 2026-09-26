# 最终镜像本机运行探测 — 2026-09-26

关联 #454 / #383 / PR #453。结果：**外部阻塞，未执行同镜像浏览器验收**。

## 本轮实际探测

1. 系统没有 Podman／Docker 可执行文件。`unshare -Ur true` 成功，说明当前用户可创建单用户命名空间，但这不代表完整 rootless Podman 可运行。
2. 从 Ubuntu 24.04 仓库下载 Podman `4.9.3+ds1-1ubuntu0.2`、conmon `2.1.10+ds1-1build2`、crun `1.14.1-1` 和依赖，解包至仓库外 `/tmp/ftrade-podman-tools/`。`podman --version` 返回 4.9.3；未改系统包、项目依赖或锁文件。
3. 使用临时引擎配置、私有 runroot/storage 和 vfs 初始化 rootless 引擎。现有 subuid/subgid 范围存在，但 `newuidmap` 返回 `write to uid_map failed: Operation not permitted`。这确认当前可用映射 helper／宿主权限不足；没有通过特权容器、关闭隔离或修改宿主策略代替原验收。
4. 对 `ghcr.io/ban12-project/f-trade-platform-browser:sha-b29c3e64bf7f851313279179c4905d114fbfcc4d` 做匿名 registry 读取，HTTP 401。未取得镜像，不从其他镜像或本地重建产物替代最终发布镜像；没有提取或保存用户 GitHub 凭据。

预期 browser OCI 索引摘要仍来自已核对的历史镜像发布日志：`sha256:60dee95faafbcd77c1b25dfe412e7b5810699f29ee4a62214ed2f48d38d69aff`。本轮没有拉取并验证这个摘要，也没有取得实际 amd64 image ID。

## 验收矩阵

| 条件 | 本轮结果 |
| --- | --- |
| 精确最终镜像拉取及摘要核对 | 外部阻塞：registry 身份／包读取权限 |
| 本机 Podman 同镜像媒体解码、PID/内存限制 | 外部阻塞：rootless UID 映射；未运行浏览器，不计通过 |
| 隔离 Sandbox 同镜像验证 | 未执行：没有可用 Sandbox 身份与受控环境 |
| 既有 profile、身份、固定出口、跨任务／重启 | 未执行：没有当前获授权 profile；没有创建替代会话 |
| 凭据领取次数 | 本轮 0；未进入凭据领取步骤，不表示已验证会话复用 |
| 生产接入 | 未执行；仍须按现有同镜像验收和回滚手册推进 |

原始本机输出保存在 `/tmp/ftrade-podman-tools/`。后续需可用的 rootless 映射／容器宿主和只读镜像拉取权限；真实 profile／Sandbox 与逐帖授权仍按既定范围单独提供。执行顺序继续遵循 [受控部署手册](../mvp1-managed-sandbox-rollout.md)，不得用历史 CI 或空收件箱替代本轮真实回执／DM 证据。
