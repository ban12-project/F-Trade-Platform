# Workflow 与图片入口安全补缺 — 2026-10-07

关联 [#498](https://github.com/ban12-project/F-Trade-Platform/issues/498)。**本轮兼容补丁与合成回归通过，依赖风险仍开放，正式 MVP 业务验收仍 pending。** 机器计数见[摘要](workflow-security-patches-20261007.summary.json)。

## 基线与修复

基线 `main@f3b7a22`，独立 worktree；保留用户原分支及其 16 个未提交文件。Node 24.21.0、pnpm 12.3.4、Next 16.3.8、TypeScript 7.0.2；Cache Components、默认 Turbopack、两个 React Compiler 开关和默认 TypeScript CLI 均保留。

同一轮新扫描在补丁前匹配 0 critical / 10 high / 13 moderate / 4 low；补丁后为 **0 critical / 3 high / 1 moderate / 0 low**。计数是公告与依赖版本匹配，不代表已证明应用可被利用。先前 #498 的 9 high 是当时扫描记录，不能与此次新扫描混作同一基线。

| 依赖入口 | 本轮变化 | 可观察验证 |
| --- | --- | --- |
| `@workflow/core@4.8.4 → devalue` | 精确父版本限定 override：5.8.1 → 5.9.3 | 旧序列化数据、循环引用和类型回读通过；合成 Buffer 切片仅保留可见 4 bytes |
| `@workflow/world-local@4.3.0 → undici` | 精确父版本限定 override：7.28.0 → 7.29.1 | Node 全局 fetch 使用该依赖的 dispatcher；GET 有界重试、POST 失败仅发起一次 |
| `@workflow/world-vercel@4.7.0 → undici` | 同上；生产 world 也补齐 | 同一兼容检查独立解析生产 world 的依赖 |
| 应用及 Next 的 sharp | 0.35.4 → 0.35.5，包含相应原生包更新 | PNG/JPEG 完整解码、损坏文件、动画、尺寸与回执限制通过 |
| 产品图片字节校验 | 进入 libvips 前核对 PNG/JPEG 文件头 | 禁用 SVG loader 时，伪装 PNG/JPEG 均在解码前以声明不符拒绝 |

Override 仅覆盖上述精确父版本；上游换版后必须重新评估，而非让覆盖隐式跟随未知版本。锁文件保留原有 Zod 及其 peer 解析，没有混入无关依赖刷新；冻结锁文件安装通过。

## 复现与兼容证据

- **Buffer 隔离**：仅用合成 128-byte 分配中的 4-byte 切片测试。旧 devalue 5.8.1 的回读 backing buffer 为 128 bytes，并包含切片之外的合成标记；5.9.3 回读为 4 bytes，标记不存在。未读取真实密钥，未证明真实业务发生过泄漏。[上游补丁说明](https://github.com/sveltejs/devalue/releases/tag/v5.9.3)与[安全公告](https://github.com/sveltejs/devalue/security/advisories/GHSA-4q55-j62x-fr9h)提供修复依据；公告的维护者评级与 registry 评级并不完全一致，扫描计数沿用 registry。
- **重放稳定性**：升级前冻结 8 个合成 seed、共 64 个 21-character ID，以及旧 devalue wire。当前依赖全部匹配该固定夹具；支持 Date、BigInt、Set、Map、Uint8Array、对象和循环引用。CI 新增独立兼容检查。夹具不会随升级自动重写。
- **拒绝不兼容升级**：尝试 nanoid 5.1.16 后，原有 seeded `customRandom` 重放 ID 不匹配；撤回该 override。不能通过更新期望或只看补丁版本消除兼容失败。当前 Workflow 的可观察 hook 路径使用固定 21-character 生成器，未发现应用将外部输入传入非安全生成器或 size 参数；这仍不足以宣称所有上游路径均安全。[上游 5.1.16 说明](https://github.com/ai/nanoid/releases/tag/5.1.16)。
- **HTTP 兼容**：两个 world 解析的 7.29.1 dispatcher 均通过 loopback 合成检查。GET 首次 503 后第二次 200；POST 503 返回 `UND_ERR_REQ_RETRY`，请求计数保持 1。初版测试误以为 RetryAgent 会直接返回 POST 的 503 Response，按实际异常契约修正断言；没有放宽请求计数。应用队列的完整授权及持久化回归仍由关联 PR 的 CI 记录。
- **SVG 解码入口**：旧检查在 metadata 自动解码后才比较格式；正常无害 SVG 改名 PNG 会进入 SVG loader。禁用该 loader 的旧代码返回原生解码错误，当前代码在进入解码器前拒绝。只使用无害 SVG，没有利用载荷或 RCE 证明。sharp 新补丁对应 librsvg 公告，风险有运行环境与输入条件，[公告](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)及[发布说明](https://github.com/lovell/sharp/releases/tag/v0.35.5)为升级依据。

## 当前应用复测

在新建的独立本机合成营销项目，通过真实浏览器提交小型合成 CSV 和改名 PNG 的无害 SVG。两份文件实际上传至关联私有 Blob，并独立回读校验原始字节 hash；本机数据库使用新 PostgreSQL 合成环境，未连接生产数据库。

导入返回 HTTP 400，服务端记录失败阶段为 `images`；页面显示既有安全错误提示并恢复提交按钮。CSV 保存 1 项来源证据，伪装图片未生成证据；项目的产品 stream run 计数为 0，未进入模型生成。没有更换真实默认模型或发送付费模型请求。

Next `/_next/mcp` 的全路由编译问题列表、配置及会话错误列表均为空；浏览器 React tree 和 ProductAgentForm fiber inspect 成功。合法 PNG/JPEG 在实际原生解码回归中通过；本轮浏览器专项只覆盖伪装图片拒绝，不宣称新的完整生产工作流验收。

两份新测试 Blob 已逐一删除，禁用缓存的独立读取均确认不存在；本机项目归档并保留测试审计。历史 Blob、原工厂参考文件、生产账号和生产数据库没有改写。

## 仍开放的风险

| 剩余匹配 | 已核对的入口与限制 | 完成条件 |
| --- | --- | --- |
| nanoid 5.1.6：2 high | Workflow core 精确固定；强制补丁会改变 seeded 重放 ID | 上游兼容迁移或经过验证的重放版本策略；现有运行不得静默换 ID |
| braces 3.0.3：1 high | shadcn CLI → fast-glob/micromatch；本轮公告没有 patched version | 确认可接受的工具输入边界并等待或验证上游修复；不视为已发现公开应用入口 |
| esbuild 0.18.20：1 moderate | Better Auth → drizzle-kit → esm-loader → core-utils；涉及旧开发服务器工具路径 | 核对该工具服务器是否真实启用、是否暴露；兼容修复不得破坏认证/迁移工具 |

上述风险继续由 #498 跟踪。生产部署、真实 Facebook 链路、完整工厂事实与图片、真实设备和客户样本仍按 MVP 总验收分别补齐。
