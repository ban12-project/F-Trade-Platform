# 新工作首次键盘操作复验 — 2026-09-27

关联 #467 / #454 / #391，随 PR #466 交付。模型验收成绩单列于 [Harbor 报告](harbor-gpt6-luna-20260927.md)。

## 原始失败与本地复现

文档提交 `52f5ca75983eb3b214af22db633624e3c4d6171a` 的 [Playwright CI 36300835508](https://github.com/ban12-project/F-Trade-Platform/actions/runs/36300835508) 中，242 项通过，键盘打开新工作弹窗一项失败。首次及两次重试均在按 Enter 后等待 dialog 超时；后续登录态数据库浏览器步骤未执行。原始源码行为与 main `27866ff` 一致。CI 日志可读，附件下载工具返回的地址在本机为 403，未声称检查了原始 trace。

在 WSL Podman 以该提交完整源码和冻结依赖构建生产测试应用。基线镜像 `sha256:7f9ac8fb9baf9ee53c4520732c338112faa99734fafb16af7fc4e9b132f2100b`；Node 24.21.0、pnpm 12.3.4、Next 16.3.2、Playwright 1.62.1。应用只使用合成配置、不可连接的合成数据库地址，没有挂载生产环境文件。

拦住 18 个 Next 静态脚本请求后，按钮可见且 enabled、aria-expanded=false；此时按 Enter，再放行脚本，弹窗仍未出现，probe exit 1。新增 Playwright 回归在修复前同样失败：预期脚本加载期间按钮 disabled，实际 enabled。两份失败证据均保留。这证明了可复现的过早交互缺陷；没有借助不可读的 CI trace 推断原运行每个事件的时间。

## 修复与契约

`NewWorkProvider` 通过 React 的服务端/客户端快照区分 hydration，只有客户端就绪且项目数据可用时才启用按钮。此前仅检查项目数组是否存在：当服务端已提供项目数组时，静态预览会过早显示可用。继续使用现有 shadcn Button；没有新增公共 API、服务端写入、授权规则或业务审批。

新增回归延迟真实脚本请求，检查可见但禁用的预览；放行后一次 Enter 必须打开弹窗，Escape 必须关闭并恢复焦点。没有增大 timeout、重复点击或加入任意睡眠。Cache Components、默认 Turbopack、React Compiler 和本地 TypeScript CLI 保持开启。

相关旧测试的前置条件也已修正：高对比度测试先确认按钮 enabled 且实际获得焦点；键盘测试保留对模态背景按钮的访问，但排除隐藏 SSR 副本；持久导航测试先完成一次真实弹窗交互，再捕获客户端导航节点。节点单实例、切换/返回后同一 DOM 节点、焦点和样式断言均保留。

## 本地复验与保留结果

| 批次 | 结果 |
| --- | --- |
| 未修复的延迟脚本 probe / 新增回归 | 均失败，显示过早启用并丢失首次 Enter |
| 第一次修复后现代交互 | 10/11；高对比度测试在 disabled 状态直接 focus，旧前置条件不成立 |
| 相关 22 项首轮 | 21/22；导航初始 hydration 期间读到隐藏副本 |
| 相关 22 项第二轮 | 21/22；includeHidden 键盘定位器读到可见/隐藏两个副本 |
| 完成前置条件及可见节点定位修正后 | **22/22**，零重试 |
| 延迟脚本、原键盘打开/关闭、持久导航各重复 5 次 | **15/15**，零重试 |
| 生产测试构建、TypeScript、目标文件 Biome | 通过 |

隐藏副本的检查发生在初始 hydration，而非被测的客户端路由切换；不能把捕获预览 DOM 的结果当作持久客户端导航行为。首次失败及每次复验都保留，未直接重跑原 CI 来忽略失败。最终全仓 CI 在修复提交重新运行，以新结果决定是否合并。

## 日志摘要

本地文件位于 `/tmp/ftrade-new-work-20260927/`。仅提交脱敏结论与哈希，原始控制台和错误上下文保留本地。

| 日志 | SHA-256 |
| --- | --- |
| ci-failure-excerpt.log | `7aae6b2a99ae0ad5f3169d8927a910fd4fc83c8523d6a564e1b982447b25d92c` |
| local-first-failure.log | `29f6d630635fc0a2751474c463366ef7668c84211ab0dc6fd8dd5c73d61ad8dc` |
| regression-before-fix.log | `3da3aaceb62d43b63cde41cc423fc1b4bb7ac1f2a98c46c79d9541b69b746ce9` |
| modern-ux-fixed.log | `4a2c3985d87befefa344b47ad2604e8d156913bb871ad4909fd1af9a0b537fa5` |
| related-final.log | `23e78049e84ac6789d2a435ca8e8db50e283a65acd9bfc2b2108d5f651ce82d6` |
| related-recheck.log | `42bce43320d459297d607ab3ff202e580f132ff905a59c52db494a174406b7c5` |
| related-second-recheck.log | `062edb5e4dab05be6ffa99adc656643d2805db50283b69dc30f836b5a81bb9a7` |
| cold-keyboard-repeat.log | `495a2f42a0c43b12b0a4f169364935930abc07d41ad2c6f2397ba47674951f6a` |
| build-fixed.log | `fb98aa980acc3db5547d63710053b014ee16cc1ff4529591017567623b2d6261` |
| typecheck-recheck.log | `8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92` |

本轮 Chromium、触摸和高对比度模拟不替代 #391 的实机、VoiceOver/NVDA 或人工检查。#32 正式业务验收仍 pending。
