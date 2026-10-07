# M1 / M2 未完成工作核对 — 2026-10-07

关联 [#521](https://github.com/ban12-project/F-Trade-Platform/issues/521)。核对基线为 `main@8b415234c132c0b61bb4c476d8e6b980decfd82e`，GitHub 当前 M1 有 3 项 open，M2 有 5 项 open。本轮处理过时的任务状态与范围归属，不新增业务验收通过，也不关闭尚未满足条件的 Issue。

## M1：三个任务的当前边界

| Issue | 已有可核对证据 | 当前处置与剩余条件 |
| --- | --- | --- |
| [#5 产品数据闭环](https://github.com/ban12-project/F-Trade-Platform/issues/5) | 缺失识别、字段证据拒绝、真实性门禁已有受控模型、数据库及浏览器检查；四份参考 PDF 的生产上传、私有完整回读通过；部分生产测试草稿的三个来源绑定及刷新保留通过 | 更新父任务的技术检查状态。保持 open：20 个具体真实试点 SKU 的完整事实、图片对应及工厂业务复核未完成；不能把受控 MOCK Ready 写成真实工厂 Ready |
| [#6 选择并授权真实 SKU](https://github.com/ban12-project/F-Trade-Platform/issues/6) | 用户已经持续授权 `docs/reference/` 工厂资料测试，并委托 Agent 完成本次测试审核；历史 A–D 各五槽位已有受控测试证据 | 更新授权范围，明确 reference 测试不再等待 #6 或重复签字。保持 open：具体真实试点 SKU 清单、逐 SKU 保密等级和真实资料／图片矩阵未具备；历史受控分组含独立 MOCK 补充，不等于该清单 |
| [#268 目录验收](https://github.com/ban12-project/F-Trade-Platform/issues/268) | 原编号族、重复记录及物理页缺陷已修复；当前生产上传、原文件名识别、部分字段绑定、正常私有来源预览与匿名 403 已有检查点 | 保持 open，沿用已有最新检查点。完整真实 SKU、实物图、全部字段定位及 Product Ready 仍待验收；原失败和浏览器 PDF 调试限制保留 |

M1 的实现／受控测试与真实工厂验收应分别记录。参考资料中没有的 OE、适配、尺寸、花键、材料、认证或商业事实仍为空，不能用新的模型调用消除资料缺失。

## M2：五个任务的当前边界

| Issue | 已有可核对证据 | 当前处置与剩余条件 |
| --- | --- | --- |
| [#11 首个海外渠道](https://github.com/ban12-project/F-Trade-Platform/issues/11) | [ADR 0002](../../decisions/0002-camofox-facebook-personal-profile-mvp1.md) 已选择单个 Facebook Personal Profile；[PR #333](https://github.com/ban12-project/F-Trade-Platform/pull/333) 已交付受控 Worker 的 Sandbox 迁移 | 更新旧 VPS 描述与当前验收入口。渠道选择不再待决定；保持 open，账号责任人及实际可归因的发布／入站仍需 #156/#322/#480/#490 的证据 |
| [#49 官方账号与 DM API 资格](https://github.com/ban12-project/F-Trade-Platform/issues/49) | 已接受的 [#155](https://github.com/ban12-project/F-Trade-Platform/issues/155) 与 ADR 0002 明确限定当前浏览器传输实验；#49 自己的最新范围说明也已将 Postiz／Chatwoot 官方 API 路线留作后续风险 | 从当前 M2 移到未指定里程碑的后续待办，继续保持 open；保留原资格、OAuth、发布和入站验收清单。此处是范围归属修正，不表示官方路线通过，也不扩大当前 Profile 权限 |
| [#122 视频发布政策](https://github.com/ban12-project/F-Trade-Platform/issues/122) | 渠道、Gate 01 与逐帖确认已有决策；[ADR 0004](../../decisions/0004-mvp1-marketing-video-editing.md) 限定 MVP1 使用已有授权素材剪成最多 15 秒 | 保持 open：实际素材权利范围、保留期和具名审核责任仍需业务决定。外部视频生成预算及供应商启用不属于当前 MVP1 前置条件，不能与现有剪辑政策混为一项 |
| [#126 视频合成与导出](https://github.com/ban12-project/F-Trade-Platform/issues/126) | 当前代码包含五个版本化项目输出预设、逐字段拒绝、真实 FFmpeg 编码／音频／字幕／CTA 检查、资源测量和受控清单下载；最终 head CI 逐平台通过 | 更新技术交付检查点，保持 open。当前平台规则、所选账号路径及实际接受结果仍由 [#318](https://github.com/ban12-project/F-Trade-Platform/issues/318) 跟踪；不能因为项目预设通过就关闭整项平台验收 |
| [#156 受控发布与入站 Epic](https://github.com/ban12-project/F-Trade-Platform/issues/156) | 契约、加密持久化、签名协议、受控发布／回复、视频链路及 Sandbox 生命周期实现已有合并交付 | 分开描述已交付迁移与未完成的真实运行。[#332](https://github.com/ban12-project/F-Trade-Platform/issues/332) 仍 open，不能因 PR #333 合并把最终集成验收标为完成；当前 viewer／就绪／退役、自动发布回执、独立入站与正式试点仍待验证 |

## #126 技术证据与限制

已读取当前 `lib/video/export-presets.ts`、`export-manifest.ts`、`download-delivery.ts` 及真实渲染回归。当前清单 schema 1.3.0 将测量校验标记为 `project_export_preset`，平台结果保持 `not_evaluated`；资源缺失保留 null，峰值比特率为 `not_measured`。这些字段不能换成“平台已认证”。

从 [PR #520 最终 head 的仓库 CI 日志](https://github.com/ban12-project/F-Trade-Platform/actions/runs/37580295512/job/112658167546) 独立确认五个平台都实际执行 FFmpeg 并输出字幕、CTA、原声／静音及清单的 PASS；同一任务还通过受控成片下载与来源审核回归。该 PR 五项必要检查全部成功，另有 253 项页面、51 项认证数据库浏览器测试通过。历史音频拼接漂移、规则来源差异及本机字幕运行环境失败不因此被覆盖。

已有技术报告：[视频工作流验收](../video-workflow-acceptance.md)、[资源测量](../video-resource-measurements.md)、[当前来源范围](production-pilot-preflight-20261007.md)。本轮不重复执行这些已通过的渲染，也不把 Page API 文档用于证明 Personal Profile 当前接受规则。

## 里程碑处置和验证

本轮将更新八个原 Issue 的当前状态说明，并调整 #49 的范围归属；所有八个原 Issue 均保留 open，旧正文、评论及失败记录保留。#268 的最新部分来源验收置于历史说明前，#122 区分现有剪辑政策与后续生成预算。调整后 M1 仍为 3 项 open，M2 为 4 项 open；数量减少来自 #49 移到后续待办，不代表验收通过率增加。

文档按 Issue → 分支 → PR → CI → squash merge 交付后，逐项回读 GitHub 正文、状态与里程碑。原始资料、产品值、客户数据、认证和私有对象信息不进入这些记录。本轮不修改应用代码、门禁、平台参数或生产业务数据，也不启动 Sandbox、发布或发送消息。

[正式业务摘要](mvp1-acceptance-20261006.summary.json)继续保持六项真实业务 `not_run`、零真实 RFQ、decision `pending`。真正完成 M1/M2 仍须取得各自未满足条件，不能仅靠清理 Issue 数量认定完成。
