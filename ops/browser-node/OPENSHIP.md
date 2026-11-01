# Browser Agent 原生 OpenShip 部署

`compose.openship.yaml` 是 OpenShip 导入输入；`openship.Dockerfile` 构建常驻 Agent 镜像。部署时通过私有环境文件填入镜像、节点密钥目录及现有 state volume 的已验证宿主机路径。不能把真实密钥写入仓库。

## 网络与权限边界

- `BROWSER_AGENT_NETWORK_MODE=bridge` 启用桥接模式；未设置仍使用原 host 模式，便于回滚。
- Agent 网关在容器内监听 `0.0.0.0:9400`，固定映射到宿主机 `127.0.0.1:9400`，继续使用现有 OpenShip edge 中不记录 viewer capability 路径的安全路由。不要同时新增 OpenShip 自动域名路由，以免其访问日志保留能力令牌。健康检查使用 TCP；未经授权的 HTTP 请求仍返回拒绝。
- 每个任务仍拥有独立网络。Agent 只加入该任务网络，用任务私网地址访问浏览器 API/VNC；任务不发布宿主机端口。停止任务后断开当前 Agent 并删除任务网络。
- Agent 根据当前网络命名空间的 IP 与 MAC 匹配自身 Docker 容器；匹配缺失或歧义则拒绝启动。清理时校验任务网络的 node/run 标签，不强制断开未知容器。
- 镜像入口使用 `setpriv` 清空 bounding/inheritable/ambient capabilities，设置 no-new-privileges，再运行 tini 和 Node。保留 UID 0 是为读取原有 root 私有文件及访问 Docker socket；该控制器仍具有 Docker 宿主机管理权限。
- OpenShip 不保留的根文件系统只读、控制器 PID 限制等字段没有假装生效。控制器内存与 CPU 由可支持的配置限制；执行外部内容的任务容器仍由 Agent 直接设置只读根文件系统、禁止提权、capability 清空、CPU/内存/PID 限制和独立看门狗。

## 切换约束

正式切换前排空任务并停止旧 Agent。两个 Agent 不可同时使用同一 node key/state：启动恢复会回收该节点已有任务。原始 node key、state volume 与账号 volume 必须保留，不得为解决启动失败而自动创建空账号状态。

当前 OpenShip 导入路径不能保证按 Compose 顶层 `external.name` 使用原卷；服务卷名可能被项目命名空间改写。因此模板使用 `BROWSER_NODE_STATE_PATH` 显式绑定原卷的宿主机目录，而不是声明一个由 OpenShip 管理的新 named volume。

部署前必须用 `docker volume inspect` 获取原 state 卷的 `Mountpoint`，确认目录已经存在、`installation-id` 文件已存在，并与原部署记录的 installation ID 完全一致，再把该路径作为 `BROWSER_NODE_STATE_PATH`。不能根据猜测拼接路径，也不能为通过校验而创建目录或修改 installation ID。部署后再次确认新容器 `/var/lib/browser-node` 的挂载源与该路径相同、installation ID 不变。

**原 named volume 仍需保留，不能删除或 prune。** 新服务的 bind 挂载可能不会被 Docker 计入该 named volume 的使用引用；即使卷被显示为 unused，也不代表数据可以删除。若 Docker 数据目录或 volume driver 改变，必须重新获取并核对 Mountpoint 后再部署。

测试实例必须使用独立身份，或运行下述不连接平台的合成测试。正常启动、停止、重新部署与回滚仍需由 OpenShip 主流程验收，不能把直接 Docker 测试算作面板操作验收。

## 不连接生产平台的集成测试

`bridge-smoke.mjs` 在一次性 Agent 镜像容器内运行，要求没有现有浏览器任务。它不读取节点密钥或真实账号，不访问外部页面；为每次测试生成全新 UUID、账号卷和内部网络。

```sh
docker build -f ops/browser-node/openship.Dockerfile -t ftrade-browser-agent:openship-test .
# BROWSER_IMAGE 必须是已审核浏览器镜像的本机 sha256 ID。
docker run --rm --memory 256m --pids-limit 128 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e BROWSER_IMAGE \
  ftrade-browser-agent:openship-test node ops/browser-node/bridge-smoke.mjs
```

测试覆盖真实浏览器 API/VNC、无宿主机发布端口、任务隔离参数、未授权 API 拒绝、跨账号拒绝、cookie/localStorage 两次冷启动保留，以及正常网络清理。额外创建模拟旧 Agent，SIGKILL 后保留退出容器记录，验证 Docker 已释放网络 endpoint，新 Agent 可以删除任务网络。测试 finally 仅清理本次创建的对象。

2026-11-01 VPS 实测：桥接模式两轮真实浏览器冷启动通过。另行实测 SIGKILL 前网络 endpoint 数为 1、SIGKILL 后为 0；旧容器记录仍为 exited 时网络删除成功。因此没有加入强制断开其他容器的恢复逻辑。镜像 PID 1 的 CapInh/CapPrm/CapEff/CapBnd/CapAmb 均为 0、NoNewPrivs 为 1。

本地回归命令：

```sh
node --test ops/browser-node/network.test.mjs
node --import tsx scripts/test-browser-node.mjs
```
