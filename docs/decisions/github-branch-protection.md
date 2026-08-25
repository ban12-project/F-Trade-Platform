# M0 GitHub 治理范围决策

## 决策

M0 不以 GitHub 付费套餐才能提供的私有仓库服务端分支保护作为验收目标，也不把购买套餐列为解除条件。2026-08-23 的 GitHub API 已确认：当前私有仓库需要 GitHub Pro、Team 或 Enterprise 才能启用该能力。

这不是“已经实现等效保护”：免费控制只能减少误操作，不能阻止拥有仓库写权限的人绕过 PR 或 CI。

## M0 验收范围

以下免费且可重复检查的控制构成 M0 的 GitHub 治理验收：

- 私有仓库
- Issues 开启
- Projects/Wiki 关闭
- 仅允许 squash merge
- 禁止 merge commit 和 rebase merge
- 合并后自动删除分支
- Issue Forms、标签、Milestone、PR 模板和版本化 bootstrap 文件通过 `pnpm test:github-governance`
- `repository-validate` 在 Pull Request 与 `main` 推送时运行；本地可运行同一套校验
- 提供且可安装 `main` 误推防护 hook；安装器不得覆盖现有 hook

## 残余风险与团队流程

- 所有工作仍必须通过 Issue → 分支 → PR → `repository-validate` → squash merge。
- `CONTRIBUTING.md`、PR 模板和 CI 作为团队约定与自动检查。
- 开发者可运行 `sh scripts/git/install-main-push-guard.sh` 安装本地 pre-push hook，拒绝直接推送或删除 `main`；安装器不会覆盖已有 hook。
- 任何绕过流程的情况记录为 `type:risk` 或 `type:bug`，不把它当作服务端已保护，也不阻塞 M0 关闭。

本地 hook 可被 `--no-verify` 绕过，也无法限制未安装 hook 的写权限成员；它只是降低误操作概率。若未来业务风险要求服务端强制，应新建独立的安全治理决策，不追溯改变 M0 的完成定义。

## 配置脚本边界

`scripts/github/configure_repo.py` 只配置上述免费仓库设置；它不得尝试调用付费分支保护 API，避免把已放弃的目标重新引入日常配置。
