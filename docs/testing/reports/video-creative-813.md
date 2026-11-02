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

## ABCD runtime implementation follow-up

编辑界面新增结构化简报：主要目标、目标受众、一个买家需求、可用下一步、平台假设、含品牌标识的素材选择。角色从只读 Badge 改为多选 ToggleGroup，实时显示共享 Zod 契约错误。表单使用 react-hook-form；未保存或不完整简报不能启动 AI。旧草稿可打开保存，AI 和合成前必须补齐简报。

| Principle | Runtime enforcement | Review status |
| --- | --- | --- |
| Attention | 共享 schema 保持开场 Attention，编辑器可修改角色并显示错误；AI 根据买家需求选开场，移除统一 1–2 秒规则 | supported |
| Branding | 人工选择当前素材中含授权标识的一项，领域写入要求开场使用它；既有素材权利校验继续执行 | needs_revision：机器不能证明像素内含品牌或授权范围，逐片人工核对 |
| Connection | AI 接收受众和单一需求；领域写入要求 Connection 有字幕，consideration 必须引用已核实事实 | supported（相关性仍由人工审核） |
| Direction | AI 依据 available nextAction 选择受控 CTA，禁止承诺报价交期；保留末尾 Direction 和人工发布门禁 | supported（承接入口可用性由人工核对） |

目标策略区分 awareness/consideration/action；模型使用已保存简报，简报是数据而非可覆盖事实规则的指令。模型只能选服务器候选镜头和现有安全文案，不能新造事实。AI 写回保留人类简报，版本竞争检查继续适用。共享 schema 校验在客户端和服务端分别执行；领域 assertMarketingCreativeReady 同时保护 AI 写回及渲染提交。

验证：typecheck、test-video-creative-brief、test-remotion-abcd、test-marketing-video-edit 通过。新增两个 Playwright 浏览器用例通过（角色编辑报错、简报脏状态禁用 AI）；首次 30 秒加载超时，120 秒重跑通过。Next.js 16.4.3 Turbopack MCP compilation issues 为空，运行错误为空。实际付费模型调用、生产数据库写入和 Linux 成片字形验收未执行，不能据此声称端到端生产验收完成。

测量仍需确认询盘事件和基线；没有自动 ABCD 数值分数或转化保证。

最终表单版本再次执行新增浏览器用例：2 passed（1.6m）。另一次在热更新期间、domcontentloaded 后立即交互的运行未观察到角色变化；恢复完整 load 等待后重跑通过。最终 typecheck、video-contracts 也通过。

## Merge acceptance 2026-11-02
验收修复：保持显式 React state 驱动编辑器，同时同步 react-hook-form，修复字幕类型切换未稳定更新的问题；提交无效草稿只显示已有实时错误，避免重复提示。
最终本地验证：typecheck 通过；完整 video-workspace Playwright 11/11 通过（37.4 秒），包含事实字幕拒绝、未保存保护、审核及下载权限展示、ABCD 编辑和简报脏状态。creative-brief、remotion-abcd、marketing-video-edit、video-contracts、video-rendering、video-timeline 共六组通过。Remotion bundle 通过。全仓 biome 无 error，234 warnings / 34 infos；保留已有 Zod 版本警告。

Linux 字体验证：Podman rootless 存储不可用，改用现有 rootful 隔离容器，基于已缓存 Ubuntu 视频媒体镜像安装本 PR 相同的 fontconfig / Noto core / CJK / emoji 软件包；FFmpeg/libass 使用 Noto Sans 样式渲染合成中、日、韩、阿拉伯、英语字幕。检查输出未见缺字方框，阿拉伯文连接字形可见。对照单一 CJK drawtext 字体会缺阿拉伯字形，因此不以该路径代替实际 libass 回退验收。
复现输入：[captions.ass](../assets/video-creative-813/captions.ass)；输出：[multilingual.png](../assets/video-creative-813/multilingual.png)。命令：ffmpeg -f lavfi -i color=c=black:s=1600x900 -vf subtitles=captions.ass -frames:v 1 multilingual.png。

这是研发合并验收：覆盖编辑器、本地契约和 Linux 字体回退；不等于生产全链路验收。未调用真实收费 AI、未运行生产数据库写入，也未重新构建并部署生产 compute 镜像或验证 Chromium 最终成片。生产字体生效仍依赖镜像重建。按临时 CI 暂停政策记录本地结果后 squash merge，自动部署保持不变。
