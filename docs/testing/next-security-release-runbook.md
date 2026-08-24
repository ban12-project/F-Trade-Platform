# Next.js 安全补丁升级运行手册

## 触发条件

仅在 Next.js 官方安全公告发布并明确适用于当前 16.3 线后执行。不要根据预告、传闻或未验证的 registry
版本提前升级；先在公告中记录 CVE/公告链接、受影响范围和官方 patched version。

## 受控步骤

1. 在新的 `security/issue-36-next-patch` 分支中，将 `next` 和 `@next/playwright` 同步升级到同一个官方 patched version：

   ```bash
   pnpm up next@<official-patched-version> @next/playwright@<official-patched-version> --save-exact
   ```

2. 只提交 `package.json` 与 `pnpm-lock.yaml` 的预期依赖变化；不要借安全更新混入无关重构。
3. 运行 `python3 scripts/validate_repository.py`、`pnpm typecheck`、`pnpm test:e2e` 和 `pnpm build`。
4. 在 PR 中链接官方公告，记录实际版本和全部校验结果；CI 绿色后 squash merge。
5. 复核 `repository-validate` 的 Next 版本同步守卫通过后，才关闭 #36。

## 禁止项

- 不部署或试运行未被官方公告确认的候选版本。
- 不单独升级 `next` 或 `@next/playwright`；两者的 package.json 与锁文件版本必须一致。
- 不因本地测试通过而跳过 Playwright 或生产构建。
