# MVP1 当前验收状态

核对日期：2026-10-22。关联 [#32](https://github.com/ban12-project/F-Trade-Platform/issues/32) 和 [#332](https://github.com/ban12-project/F-Trade-Platform/issues/332)。**MVP1 总验收未完成；用户已恢复受控三账号验收。** 本轮新业务资料仅使用 `docs/reference/`，旧合成项目归档并保留原审计；受控消息不计作真实客户询盘。新运行时、模板与生产部署的工程证据见[接管修复与交付报告](reports/sandbox-viewer-rollout-20261022.md)。下文标注的 2026-10-15 状态属于历史检查点，不能代替本轮实测。

## 范围与证据基线

目标仍是[第一阶段技术方案](../background/AI外贸工作流平台_第一阶段MVP_离合器.md)中的产品资料至 `OPPORTUNITY` 闭环：一个工厂、约 20 个真实来源槽位、一个渠道、Product／Content／Sales／Follow-up 与 Workflow Orchestrator，以及三类 Human Gate。规则能解决的部分可以使用确定性实现；不能把模块名当作自主模型协作的证明。

已接受的范围修订继续有效：Facebook Personal Profile 单渠道与受控固定出口（ADR 0002）；已有授权素材的最长 15 秒剪辑（ADR 0004）；产品最终事实审核 v2，正确阻断负例可以通过流程验收但不能成为 ProductReady（ADR 0010）；网关日志按保留政策 1.1.0 排除于本次 M2 验收（ADR 0007）。官方 API 路线 #49、外部视频生成、自动报价／交期及自动成交不作为当前闭环的替代方案。

2026-10-15 检查点的仓库基线为 `d58ec52aab575447bbc09d8a43b86ec127225042`（[PR #616](https://github.com/ban12-project/F-Trade-Platform/pull/616)）。该检查点最后核对的生产应用／模板构建版本为 `0908f60872ddc1dc69f238b1f5f75c55b49fe77e`；两者之间只有测试、CI 与文档变化。浏览器运行时版本单独为 `3afb7bc3cf0917d27642d0f73c11c0d48d6199dd`，来源为成功的 [image workflow 38682365133](https://github.com/ban12-project/F-Trade-Platform/actions/runs/38682365133)。仓库合并、应用部署、模板选择与实际容器运行是不同证据，不能相互代替。

## 2026-10-22 受控续验

运行时 `aa9f83ace705c098c125f6e6c94b8bb23418aa82` 的精确 CI 制品、本地 Podman、无凭据模板及整 VM 原生档案恢复通过。原实例已保留独立回退副本，离线暂存和前后摘要检查通过；生产配置与实际容器镜像匹配。一个真实档案在当前运行后保存的窗口尺寸为 1360 × 817，位于 1440 × 900 远程桌面内。

生产工作台的 iframe 文档在浏览器控制通道中停于 HTTP 200 响应处理，两个未使用接管票据的交互任务随后正常回收。该现象不等于登录失败，也不能证明账号就绪。独立窗口方案的本地生产构建回归和全部 CI 通过，生产应用已部署为 `b32879b8d4b3444e49999e3675f76761ecfd5df9`。平台认证与同源窗口握手通过，但远程文档仍未在控制通道中交付。无凭据四组对照均复现 HTTP 200 后文档暂停，[#634](https://github.com/ban12-project/F-Trade-Platform/issues/634) 保持 open。实际身份、Messenger、连续任务、停启及入站闭环继续分别记录，不能以工程通过替代。

## Podman → Vercel Sandbox → 原账号（2026-10-15 历史检查点）

精确制品摘要、Podman config ID 与 Docker local ID 的映射、失败尝试及运行测量以[运行时交付报告](reports/sandbox-runtime-rollout-20261015.md)为准；执行步骤以[统一运行手册](mvp1-managed-sandbox-rollout.md)为准。

| 层次／要求 | 已有证据 | 当前结论与边界 |
| --- | --- | --- |
| 本地 Podman 先验收 | 选定发布制品的完整 smoke：实际 H.264 像素、受限代理无直连回退、DOM 检查、六种回执观察、原生 profile／任务／租约隔离及内核资源测量；无 OOM／限额事件 | 通过本地工程范围；rootless 存储问题没有通过重置现有数据来绕过，使用显式 rootful 连接 |
| 同制品无凭据模板 | CI artifact／archive／config／全部 RootFS 层核对后导入新 deny-all Sandbox，完整 smoke、无账号卷／节点密钥检查通过 | 模板工程范围通过；账号快照没有充当通用模板 |
| 实际创建与整 VM 恢复 | 应用 provider 入口创建独立实例，停止后恢复不同 session，合成卷标记和 IndexedDB 不可导出密钥仍可用，跨账号拒绝，资源已清理 | 合成恢复通过；不等于真实 Messenger 历史、登录或入站恢复 |
| 并发启停、授权及未知操作恢复 | [Browser node validation 38688962538](https://github.com/ban12-project/F-Trade-Platform/actions/runs/38688962538) 成功；包含真实合成 PostgreSQL 的并发预留、旧回调拒绝和未知操作恢复。该测试提交与本轮基线的 broker／provider／runtime 源码一致 | 工程回归通过；其合成授权负控不替代生产账号的撤销／退休验收 |
| 原实例镜像升级 | 独立停止回退副本；原命名实例的两镜像及启动脚本核对；账号卷、node-state 卷、配置和密钥前后摘要一致；实际停止快照确认 | 原实例离线升级通过；没有重新初始化既有 native profile |
| 生产配置一致性 | 09:03 UTC 生产部署 READY；模板、Agent／Browser local ID 与原实例暂存结果一致 | 配置检查点通过；不能用 PR 的 Vercel ignored-build 成功状态代替它 |
| 应用队列与真实 Viewer | 09:06 UTC 正常 UI 创建的任务在原实例运行，实际容器镜像／profile 归属一致；HTTPS/noVNC 已连接，零保存凭据领取 | 交互传输通过；Facebook 显示真人验证，因此登录就绪门禁未通过 |
| 同账号连续任务、换容器、停启后的在线状态 | 旧版本在线记录与当前合成／离线恢复证据均保留 | 当前发布版本的完整在线连续性、身份及 Messenger ready 回执未通过；不能用旧记录续验 |
| 密码／受支持 2FA／PIN 有界恢复 | 已实现加密、凭据范围、状态机及合成负控 | 真实账号恢复尚未完成；当前 checkpoint 需人工处理，不能自动循环登录 |
| 当前发布与入站 | 已有协议／数据库／本地与 Sandbox 回执观察回归；历史 unknown 原始回执不可改写，受托核对的人工结案与自动回执分开 | 当前页面／受众／素材审核、实际自动发布回执、独立入站去重与 RFQ 关联仍未验收；publish／login／inbox 未启用 |

用户暂缓验证后的最后一次独立读回为 **2026-10-15 09:14:52 UTC**：渠道暂停、零活动任务、原实例 stopped，云端归属／资源／时限／网络策略匹配且恢复快照可用，能力仅 `interactive`。这是带时间的已观察状态；2026-10-15 整理没有再次启动或访问账号浏览器。本次续验以新报告为准，不把历史状态延伸为未来持续保证。

此前待核对的旧视频已按用户明确授权，通过 Agent 浏览器观察和正常应用结果核对流程结案；07:53 UTC 读回确认没有未核对发布、原始 unknown 回执不变且零新增发布／重试。该私有核对不应被重新列为升级前未完成事项，也不能充作新版本自动发布回执或独立人工目击。

该历史检查点所选通用模板到期时间为 **2026-11-14 08:35:53 UTC**；当时账号回退副本到期时间为 **2026-10-22 08:09:38 UTC**。这些是替换／恢复前需重新检查的期限，不是无限期的恢复承诺。继续账号验收前须重新读回现有快照与配置、审核有效期和队列；回退副本已过期时不能依赖旧记录继续维护。

## MVP1 其他验收项

| 要求 | 当前可核对结果 | 尚需证据 |
| --- | --- | --- |
| M1 产品资料与事实审核 | [#268](https://github.com/ban12-project/F-Trade-Platform/issues/268)、[#5](https://github.com/ban12-project/F-Trade-Platform/issues/5) 已按 v2 结项：20 槽位中 10 Ready、10 正确阻断，未执行和错误放行均为 0；当前字段证据、图片、审批与受控原件回读已核对 | 不能宣称 20 条全部 Ready；未测 OCR／审核效率继续未知。GitHub M1 里程碑条目本轮读取仍为 open、零 open Issues，不以管理状态否定已完成的这项验收 |
| M2 授权真实素材成片 | [真实目录成片验收](reports/m2-real-catalogue-video-acceptance-20261010.md)已完成生产编辑、合成、本次委托审核、私有播放及 MP4／清单一致性 | 目标 Profile 的当前规则适用性和实际平台接受仍待 #126/#318；项目预设 passed 不等于平台接受 |
| 保留期与受控副本 | 90 天、具名责任与预算已决定；应用执行、来源／历史保护、[实际合成数据库备份恢复](reports/m2-retention-restore-20261015.md)均有证据；Neon 6 小时恢复窗口已盘点 | #122 的真实生产到期对象／Blob 删除、生产 Neon PITR、历史副本物理清除和其他未覆盖副本尚未证明；不改写真实时间制造样本，网关日志不重新作为前置 |
| Sales／RFQ、报价与跟单商机 | 当前领域实现、数据库授权／事务回归和 reference／合成闭环已有证据，见[实现核对](reports/mvp1-implementation-audit-20261006.md)及[reference 汇总](reports/reference-acceptance-20260917.md) | 真实客户 RFQ、人工报价／交期、发送凭据与商机认定仍待业务验收；合成消息、价格或审批不能倒填为真实业务 |
| 设备与辅助技术 | 自动化 Chromium／WebKit、响应式与权限回归已有证据 | [#391](https://github.com/ban12-project/F-Trade-Platform/issues/391) 的实机、VoiceOver／NVDA、实际缩放／对比度及所声明性能证据尚未完成；仿真不替代实机 |
| 依赖与历史故障 | 2026-10-15 依赖审计保留 1 high（braces），已安装副本有深度防护；原 CSV 失败后已有冻结输入成功及诊断关联 | [#498](https://github.com/ban12-project/F-Trade-Platform/issues/498) 的独立 CLI 未修补副本与上游发布风险、[#348](https://github.com/ban12-project/F-Trade-Platform/issues/348) 的原间歇原因仍未知；后续成功不改写原失败 |
| 集成验收与 Go/No-Go | [#26](https://github.com/ban12-project/F-Trade-Platform/issues/26)／[#32](https://github.com/ban12-project/F-Trade-Platform/issues/32) 保持 open；受控技术演示已有记录 | 完整实际渠道／业务样本及独立最终决定未完成，不能判 Go |

## 继续工作的条件

1. 用户已恢复受控三账号验收。按本轮授权与运行手册核对原 profile、身份、固定出口及 ready 状态；必要的真人验证和新增认证凭据由账号本人完成，不以重建 profile 或重复登录替代。
2. 会话门禁通过后，按文字、视频、入站各自审核范围推进；当时存在的逐帖授权须核对具体账号、内容、受众及有效条件。历史 unknown 不重试，人工结案不充作自动回执；入站按已授权受控消息范围及当前复核契约推进；未审核的执行能力继续关闭。
3. 保留期后续需要实际生产到期／供应商处理证据；本地恢复演练不能替代生产清除。设备与真实业务验收须取得相应实机／具名业务证据，不反复运行已有合成测试来替代。
4. 总验收按[六项指标与 Go/No-Go 模板](mvp-acceptance-report.template.md)形成新的明确批次。2026-10-06 的六项 `not_run` 摘要是当时批次，不能重写为本轮结果，也不能因 M1 或成片已有后续通过就虚构其余样本、计数或最终人工决定。

本页、GitHub Issue 当前检查点和运行手册共同提供入口；历史报告中的“当前”仅指该报告的检查时间。若将来观察发生变化，应追加新证据并更新本页，不静默修改历史失败或扩大旧授权。
