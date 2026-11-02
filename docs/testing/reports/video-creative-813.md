# 视频字体与创意修订（#813）

## Context
面向工业品采购者；目标采用 Action（提交需求供人工审核）；现有 1080×1920 竖屏成片，不更改发布授权。
受众熟悉程度未知。参考指南 Action 第 21–23 页，保留产品、证据字幕与明确下一步。转化提升是待测假设。

## ABCD review
| Principle | Decision / location | Evidence | Status |
| --- | --- | --- | --- |
| Attention | AbcdMarketingVideo 保留产品画面，取消橙色全屏闪光 | 现有授权素材契约；闪光本身不证明有效 | supported |
| Branding | 删除固定 F·TRADE 标记；持续展示已验证产品名 | productName 来源为现有服务端产品；产品名不等于供应商品牌授权 | needs_revision |
| Connection | 删除固定英文受众标语；字幕不再在 CTA 阶段消失 | 现有 caption 事实/营销文案校验 | supported |
| Direction | CTA 自动换行，增加底部留白，保留产品与字幕 | 原有 CTA 合约；具体承接入口仍需内容审核 | supported |

## Evidence and platform adaptations
不增加事实、折扣、认证、库存或性能承诺。沿用素材权利、工程事实和人工发布门禁。
静音可读是本模板设计选择，不声称所有平台默认静音。
底部 180px 留白是内部设计假设，不是平台通用安全区；不同发布端仍需预览。
字体依赖 Noto core/CJK/emoji，覆盖常见文字，不承诺全部 Unicode。
两个镜像都显式安装字体，避免旧 MEDIA_BASE 缺字；独立 FFmpeg 主机同样需要安装字体。

## Open questions / Risk
- 内容审核者：授权品牌资料尚未传入模板，阻止品牌审核通过，不自动生成品牌。
- 内容审核者：具体语言、CTA 承接入口和发布端遮挡需逐片确认。
- 运维：需重建并部署 compute 和 media 镜像；未做生产部署或线上成片确认。
- 本改动聚焦成片模板及字体；编辑工作台和 AI 策略未整体重写。
- 验证负责人：需在 Linux 镜像渲染中、日、韩、阿拉伯语长文案并逐帧确认；本地编译不证明字形视觉正确。

## Validation
通过 TypeScript 检查和 scripts/test-remotion-abcd.ts；既有事实、私有素材及帧数契约保持。
建议同受众、同投放条件比较人工确认的有效询盘；先确认测量可用和基线，不能据本次实现声称提升转化。

Remotion bundle 和 test-video-rendering 通过。构建报告既有 Zod 4.6.7 / Remotion 期望 4.4.3 版本警告；未调整全应用校验库，保留为渲染验收风险。
