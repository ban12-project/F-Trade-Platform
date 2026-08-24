# GitHub 分支保护能力限制

## 现状

2026-08-23 配置 `main` 分支保护时，GitHub API 返回：私有仓库需要 GitHub Pro、Team 或 Enterprise 才能启用该功能。当前仓库保持私有，因此服务端暂时无法强制 PR、CI、线性历史或禁止强推。

已成功应用的仓库设置：

- 私有仓库
- Issues 开启
- Projects/Wiki 关闭
- 仅允许 squash merge
- 禁止 merge commit 和 rebase merge
- 合并后自动删除分支

## 当前替代流程

- 所有工作仍必须通过 Issue → 分支 → PR → `repository-validate` → squash merge。
- `CONTRIBUTING.md`、PR 模板和 CI 作为团队约定与自动检查。
- 开发者可运行 `sh scripts/git/install-main-push-guard.sh` 安装本地 pre-push hook，拒绝直接推送或删除 `main`；安装器不会覆盖已有 hook。
- 任何绕过流程的情况记录为 `type:risk` 或 `type:bug`，不把它当作服务端已保护。

本地 hook 可被 `--no-verify` 绕过，只是降低误操作概率，不能作为服务器端保护的等价物。

## 解除条件

升级仓库/组织套餐或由具备相应权限的管理员启用私有仓库分支保护后，重新运行：

```bash
python3 scripts/github/configure_repo.py
```

在确认 `main` 保护成功前，不得在 README 或状态页声称“服务端已强制保护”。
