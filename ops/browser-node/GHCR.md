# Browser 镜像自动发布（PR #323 / Part of #322）

## 触发和发布范围

`.github/workflows/browser-images.yml` 在 `main` 的浏览器相关文件变更时自动构建并发布到 GHCR：`ops/browser-node/**`、Agent 使用的 `lib/browser-fleet/policy.ts` / `security.ts`、镜像冒烟测试脚本、发布 workflow、共用 composite action 和根 `.dockerignore`。无关业务文件变更不触发镜像发布。

PR（包括 fork）在 AMD64 和 ARM64 原生 runner 上构建两种镜像并做冒烟测试，不登录 GHCR、不推送、没有 `packages:write`。发布任务与 PR 验证任务分离；没有 `pull_request_target`。工作流合入默认分支后也支持 `workflow_dispatch`，且只能从 `main` 发布。不提供绕过主分支限制的任意 ref 输入。

主分支使用内置 `GITHUB_TOKEN` 和发布 job 的 `packages:write`，不要求新增 PAT Secret。仓库/组织仍须允许 Actions 创建或写入对应 GHCR package。workflow 不修改 package 可见性、不把私有源码自动公开，也不远程更新 VPS。

## 镜像与标签

| 镜像 | 用途 |
| --- | --- |
| `ghcr.io/ban12-project/f-trade-platform-browser-node` | 常驻节点 Agent 与接管网关 |
| `ghcr.io/ban12-project/f-trade-platform-browser` | Camofox + noVNC + 独立租约看门狗，按任务启动 |

两种镜像作为同一个提交版本构建，均支持 `linux/amd64`、`linux/arm64`。Camofox 基础目标只是 Bake 构建依赖，不单独发布。`camofox.ref` 固定上游源码提交，修改该文件会触发新镜像；CI 与本地构建共享这个来源。基础镜像与软件包仍可能更新，固定源码 SHA 不等于整个供应链完全可复现。

每个架构先生成 `run-<workflow run id>-<attempt>-<arch>` 标签；两个架构的构建、镜像内容、API 启动和看门狗退出测试均通过后，才发布该提交的 `sha-<完整40位提交>` 多架构标签。只有该提交仍是最新 `main`，才更新 `main`、`latest`。旧提交重跑不会把这两个滚动标签回退。各架构发布失败时不会推进滚动标签，可能留下未被推广的 run 标签。

GHCR 不保证多镜像标签更新的事务性，也不把 SHA 命名的 tag 自动变成不可变对象；同一提交重跑可能因基础依赖变化产生新 digest。严格锁版使用两个明确的 `image@sha256:...` digest，日常跟踪可使用同一提交的 SHA 标签。构建会附加 source/revision 标签，并在推送时生成最小 provenance 和 SBOM。发布结果与镜像引用写在 Actions Summary。

## 无需在 VPS 构建

使用该分支中的 `compose.ghcr.yaml`、`Caddyfile` 和 `.env.ghcr.example`，不需要下载上游源码或在 VPS 安装 pnpm。首次镜像发布成功前，这些 GHCR 引用可能尚不存在。

在仓库根目录：

```bash
cp ops/browser-node/.env.ghcr.example ops/browser-node/.env
chmod 600 ops/browser-node/.env
# 填写平台地址、节点 Key、接管域名；保留两个镜像为同一版本。
docker compose --env-file ops/browser-node/.env \
  -f ops/browser-node/compose.ghcr.yaml config --quiet
docker compose --env-file ops/browser-node/.env \
  -f ops/browser-node/compose.ghcr.yaml pull
docker compose --env-file ops/browser-node/.env \
  -f ops/browser-node/compose.ghcr.yaml up -d --no-build
```

`browser-image` 是仅执行 `/bin/true` 的一次性镜像加载服务，不会常驻 Firefox；它确保运行时已进入宿主机 Docker image store，再启动依赖它的 Agent。Agent 仍按容量领取任务、为每个账号启动隔离浏览器。

如果已有 `.env`，不要用示例覆盖密钥。在已有配置中补充 `BROWSER_NODE_IMAGE` 和更新 `BROWSER_IMAGE` 即可。使用与原部署相同的 Compose 项目名，以复用 `node-state`、证书卷和安装标识；不要执行 `down -v`，也不要清理账号的 `ftbrowser-*` 数据卷。

升级前先停止接收新业务任务或等待活动任务结束，特别是不能打断正在提交的帖子。拉取新镜像后用 `up -d --no-build --force-recreate agent` 重建 Agent，使其重新解析浏览器镜像 ID；单纯 `pull` 不会更新已经运行的 Agent 使用的镜像 ID。更换两个镜像为之前验证过的 SHA tag/digest 后用相同步骤回滚。数据库迁移不由镜像发布/更新自动执行，镜像回滚也不回滚数据库。

如 package 为私有，VPS 需要先 `docker login ghcr.io`，凭据需有相应 package 的读取权限。业务节点 Access Key 只用于 F-Trade，不是 GHCR 的拉取凭据；公开 package 通常不需要 registry 登录。平台加密主密钥、Facebook 密码、代理密码、账号 profile 不进入镜像或构建参数。

原有从源码构建方式保留在 `compose.yaml` 与 `build-browser.sh`。节点信任模型、加密存储、TLS/域名和业务执行器限制仍见 [README.md](README.md)。发布镜像不表示原 Facebook 自动发布/DM 业务集成已验收。

## 验证边界

新增 CI 对每个架构实际加载镜像，验证模块导入、架构/revision 标签、VNC 依赖、浏览器二进制版本、服务器健康和独立租约到期退出；还验证 GHCR Compose 无构建项且正确预拉取浏览器镜像。测试容器使用禁网和临时存储，不访问 Facebook、不登录真实账号。

这些测试不替代真实 VPS 的 HTTPS/noVNC、固定代理、真实登录/2FA、图片/视频发布及私信接收验收。PR 验证也不测试实际 GHCR 写入权限，首次主分支发布成功才证明 registry 发布链路可用。

官方依据：

- https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
- https://docs.docker.com/build/bake/contexts/
- https://docs.docker.com/build/ci/github-actions/multi-platform/
