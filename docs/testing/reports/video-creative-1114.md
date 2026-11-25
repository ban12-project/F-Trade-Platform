# Google Ads ABCD 视频广告指南（14783551）优化评审记录（#1114）

## Context

- **受众**：海外汽车售后市场进口商、批发商与维修厂采购负责人（对具体供应商品牌熟悉度默认为 `unknown`）。
- **内容载体**：1–3 个授权素材合成的 `≤15` 秒营销短视频，以及离线视频生成结构化场景契约。
- **目标平台**：Facebook（Personal Profile / Reels）、Instagram Reels、TikTok、X（横屏 `1280×720`）与 YouTube（横屏 `1920×1080`）。
- **预期行动**：引导买家提交车型、OE 编号或采购需求进入人工审核与报价/交期确认流程。

## Objective rationale

- **可选目标矩阵**：支持 `awareness`、`consideration`、`action` 及 `answer/14783551` 新增的 `full_funnel` 四类目标。工业品外贸询盘场景默认常用 `action` 或 `consideration`；当需要串联供应商背景、至少一项已核实产品事实与收尾 CTA 时，可选用 `full_funnel`（强制至少 2 个片段且至少 1 个片段展示已核实产品信息）。
- **叙事节拍适配**：新增可选 `pacingMode: "shorts_organic"`，对照 `answer/14783551` 中的 *ABCDs of YouTube Shorts* 顺序（`Connection → Attention → Branding → Direction`），支持竖屏短片以产品真实使用情境或买家痛点开场、品牌素材自然融入后续叙事；默认 `core_abcd` 继续保留开场 `Attention + Branding` 约束。
- **合规限制**：不采用虚构紧迫感、库存短缺或未确认折扣，不从外部来源引入效果预测。

## ABCD decisions

| Principle | Decision / artifact location | Evidence | Status |
| --- | --- | --- | --- |
| Attention | `lib/video/shot-analysis.ts` 增加 `signalstats` 亮度与对比度评分并在选镜排序中降权暗场与低对比度片段；`remotion/AbcdMarketingVideo.tsx` 收窄边距并移除中央压暗渐变以实现紧凑明亮构图；`lib/video/ass-subtitles.ts` 消除字幕与 CTA 重叠 | `answer/14783551` Core ABCDs；FFmpeg `signalstats` 确定性像素统计（不代表语义质量） | `supported` |
| Branding | `lib/video/edit-contracts.ts` 与 `components/workspace/marketing-video-panel.tsx` 在 `shorts_organic` 下允许品牌素材绑定到任一 `branding` 片段；`remotion/AbcdMarketingVideo.tsx` 在非品牌阶段降低顶部条透明度避免遮挡 | `brandAssetRef` 人工选材与既有权利证据检查；机器无法证明像素中存在合法授权商标 | `needs_revision` |
| Connection | `lib/video/edit-contracts.ts` 收紧短片段（`<2s` 限 50 字）与 `direction` 片段（限 72 字）创意文案长度；`workflows/marketing-video-processing.ts` 与 `lib/video/contracts.ts` 强制工程事实绑定 `ProductReady` | `ProductReady` 事实契约及 `assertMarketingCreativeReady` 前后端共享校验 | `supported` |
| Direction | `lib/video/ass-subtitles.ts` 修复 `CTA` 样式原 `Alignment=5` 居中遮挡主体的问题，改为底部安全区 `Alignment=2` 并自动抬升重叠字幕；`action` 多片段要求先建立 `connection` 上下文再呈现 `direction` | `answer/14783551` *Present the ask after the context is set*；人工发布与报价/交期门禁保留 | `supported` |

## Evidence

- **外部参考**：Google Ads Help [About the ABCDs of effective video ads](https://support.google.com/google-ads/answer/14783551?hl=en)（2026-11-25 核查）、[About video ad specs](https://support.google.com/google-ads/answer/13547298)、Think with Google ABCDs Playbook（2022-04）。
- **内部基线与门禁**：[marketing-video-creative.md](../../guidelines/marketing-video-creative.md)、[evidence-bound-product-video.md](../../architecture/evidence-bound-product-video.md)、[ADR 0004](../../decisions/0004-mvp1-marketing-video-editing.md)、[ADR 0007](../../decisions/0007-marketing-video-release-policy.md)。
- **离线生成治理边界**：`lib/video/contracts.ts`、`lib/video/creative.ts` 与 `lib/video/execution.ts` 仅做离线结构化契约与提示词安全对齐；`lib/video/mvp-policy.ts` 保持默认关闭外部视频生成，预算保持 `0`。

## Platform adaptations

- **静音优先与音轨感知**：Facebook、Instagram、TikTok 与 X 等平台默认不假设用户开启声音。`lib/video/visual-sampling.ts` 与 `lib/video/sandbox-media.ts` 实测并透传 `hasAudio`，`lib/video/shot-candidates.ts` 对无音轨视频强制归并 `audioMode: "muted"`，所有关键产品信息继续通过静音可读字幕表达。
- **横竖屏与安全区**：`shorts_organic` 禁止用于横屏 `x` 平台；当前 `youtube` 导出预设保持 `1920×1080` 横屏，`facebook` / `instagram` / `tiktok` 为 `1080×1920` 竖屏，不同平台成片仍须逐片人工预览确认遮挡安全区。

## Open questions

1. **内容与产品负责人（`coda`）**：是否需要为 YouTube Shorts 单独新增 `1080×1920` 导出预设（例如区分 `youtube` 横屏与 `youtube_shorts` 竖屏）？（不阻塞本次契约与编辑器交付，当前 `youtube` 保留 `1920×1080`。）
2. **内容审核者（`coda`）**：是否补充独立的授权品牌 Logo 或受控配音资产进入 `ProductMedia`？（缺失时不阻塞交付，维持静音字幕与人工品牌权利复核。）
3. **预算负责人（`coda`）**：外部视频生成保持 `VIDEO_GENERATION_ENABLED` 关闭且预算为 `0`（阻塞付费生成运行，不阻塞离线契约对齐）。

## Validation

- 本次实施在本地运行 TypeScript 类型检查、Biome 检查、Remotion 打包、`validate_repository.py`、视频契约/镜头分析/剪辑/渲染边界/Workflow v5 运行时单测及 Playwright `tests/e2e/video-workspace.spec.ts`；
- 宿主机无本地 FFmpeg 二进制，FFmpeg 真实转码、字幕烧录与采样测试（`test-ffmpeg-renderer`、`test-video-visual-sampling`、`test-rendered-video-inspection`）与数据库回滚读取检查由 GitHub Actions CI（`repository-validate`、`playwright-chromium`）执行并核实。
- 实际投放转化对比须待同受众、同渠道基准建立后再做假设检验，不以指南研究数据声称投放提升。
