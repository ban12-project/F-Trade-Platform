# PR #415 候选运行时审计 — 2026-09-26

关联 #378 / #454 / #32；对象为草稿 [PR #415](https://github.com/ban12-project/F-Trade-Platform/pull/415)。本轮结论：**候选不能升级为完整通过，保持草稿**。当前 MVP 运行时没有切换。

## 版本与方法

- 只读抓取并审查候选 head `c485a277ee15287b5d9e8cd25ce93f5e46c6f5c8`。PR 的 base 为 `92f6c4befe6aa09ae6b1f8c181dc90ee075a92c8`，不是本轮主线基线 `64b4163`；未把历史合并引用测试当成与当前 main 集成通过。
- 候选 `ops/browser-node/camofox.ref` 固定服务 `30aea0444171a20549c58c29101f6ab682157d56`。专用候选镜像入口与默认发布镜像不同，默认镜像 CI 成功不能证明 Firefox 155 候选镜像。
- 本轮读取源码及 GitHub CI 状态，没有真实浏览器、Agent、容器或生产身份联调。没有重新执行候选的运行测试，也没有合并、部署或发布镜像。

## 本轮可验证证据

与 head 关联的七个工作流均成功：[生产构建](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35712212657)、[仓库](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35712212728)、[Playwright](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35712212910)、[节点](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35712212890)、[fleet 与消融](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35712212844)、[worker](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35712212810)、[镜像工作流](https://github.com/ban12-project/F-Trade-Platform/actions/runs/35712213224)。这证明这些历史 CI 的状态，不补足下表缺失的真实联合验收。

| 验收项 | 源码观察／历史范围 | 本轮结论与剩余条件 |
| --- | --- | --- |
| 接管身份与重授权 | store 在节点行锁下轮换单次 token；限制原会话、租约和 deadline；gateway 要求 ticket 对应 slot 的 Origin | 静态审查成立，历史组件／PostgreSQL CI 成功；完整应用 HTTP 登录／会话中间件仍未联验 |
| 输入与自动化互斥 | control 先取得后端 grant；gateway 先等待旧输入清理再替换；失败保持 paused 并要求 Agent 停止 | 代码路径存在；真实 Agent 后台 egress 与 saved-login handoff 未在本轮执行 |
| 撤销传播 | 已建立 tunnel 有独立到期检查；dispose 撤销 sockets/capabilities 并跟踪异步 release；不确定 release 不恢复自动化 | 组件覆盖不能替代真实 broker 撤销→Agent→gateway→后端输入关闭全过程测量 |
| 浏览器崩溃 | PR 记载同一封装包上的真实 SIGKILL 后输入停止及新进程恢复 | 本轮无法重新核对上游运行原始产物；作为 PR 记载的历史证据，不新增 PASS |
| 服务重启 | PR 记载 SIGTERM、cookie/localStorage、重新取得 lease 和 REST 输入通过 | 不是完整 Firefox profile 恢复；突然 SIGKILL 服务与全 profile 恢复仍缺证据 |
| 镜像身份 | 专用安装器校验外部包摘要、源码、清单、文件哈希、ELF；服务 ref 固定为 30aea04 | 本机无容器服务／封装包；没有同镜像重验，不能将默认镜像成功计入候选结果 |
| 完整候选总门禁 | PR 明确保留兼容性 fallback、proxy/bypass 和完整 profile 等缺口 | 保持未通过，不拼接不同封装包／服务版本的局部成功 |

静态来源：[store](https://github.com/ban12-project/F-Trade-Platform/blob/c485a277ee15287b5d9e8cd25ce93f5e46c6f5c8/lib/browser-fleet/store.ts)、[gateway](https://github.com/ban12-project/F-Trade-Platform/blob/c485a277ee15287b5d9e8cd25ce93f5e46c6f5c8/ops/browser-node/gateway.mjs)、[control](https://github.com/ban12-project/F-Trade-Platform/blob/c485a277ee15287b5d9e8cd25ce93f5e46c6f5c8/ops/browser-node/control.mjs)、[Agent](https://github.com/ban12-project/F-Trade-Platform/blob/c485a277ee15287b5d9e8cd25ce93f5e46c6f5c8/ops/browser-node/agent.mjs)、[专用镜像说明](https://github.com/ban12-project/F-Trade-Platform/blob/c485a277ee15287b5d9e8cd25ce93f5e46c6f5c8/ops/browser-node/CANDIDATE.md)。

## 历史来源可访问性

PR 描述列出了上游 [服务恢复 35711969349](https://github.com/ban12-project/camoufox/actions/runs/35711969349) 与 [更新镜像 35712439409](https://github.com/ban12-project/camoufox/actions/runs/35712439409)，并指向封装包 SHA-256 `fea07e17a098d8670bf1ee8945a27eadfcc88a072e0cd646be4291ef9c1b3639`。本轮连接器读取这两个上游 run 的 API 均返回 404；原因未确定，不能据此判断运行不存在，也不能声称已读取原始报告。

完成候选验收仍需可访问的原始产物、同一可追溯封装包／镜像、独立合成身份、真实应用 HTTP 接管链路与退出／撤销／恢复测量。#378 和 #415 不满足完整关闭／转正式条件；这不把候选升级变成当前 Profile MVP 的前置条件。
