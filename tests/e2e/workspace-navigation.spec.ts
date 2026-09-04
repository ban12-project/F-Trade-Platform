import { expect, test } from '@playwright/test';
const root = '/testing/workspace-navigation';
const projectId = '00000000-0000-4000-8000-000000000263';

test('shared dock stays mounted and interactive while a child route streams', async ({ page }) => {
  await page.goto(root);
  const dock = page.getByTestId('workspace-action-dock');
  await expect(dock).toBeVisible();
  const original = await dock.elementHandle();
  const click = page.getByRole('link', { name: '切换测试页面' }).click({ noWaitAfter: true });
  await expect(page.getByRole('status', {name: '正在加载项目工作区'})).toBeVisible();
  await expect(dock).toHaveCount(1);
  expect(await page.evaluate((element) => element === document.querySelector('[data-testid="workspace-action-dock"]'), original)).toBe(true);
  await dock.getByRole('button', { name: '待办', exact: true }).click();
  await expect(page.getByText('当前没有待处理事项。')).toBeVisible();
  await click;
  await expect(page.getByRole('heading', { name: 'Synthetic persistent workspace' })).toBeVisible();
  expect(await page.evaluate((element) => element === document.querySelector('[data-testid="workspace-action-dock"]'), original)).toBe(true);
  await dock.getByRole('button', { name: '项目', exact: true }).click();
  await expect(page.getByRole('link', { name: /Synthetic persistent workspace/ })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(page.getByRole('heading', { name: '导航测试起点' })).toBeVisible();
  expect(await page.evaluate((element) => element === document.querySelector('[data-testid="workspace-action-dock"]'), original)).toBe(true);
});

test('page and dock share one unsaved-changes guard across navigation', async ({ page }) => {
  await page.goto(root);
  await page.getByLabel('测试草稿').fill('Do not lose this draft');
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('link', { name: /Synthetic persistent workspace/ }).click();
  const confirmation = page.getByRole('alertdialog', { name: '放弃未保存的修改？' });
  await expect(confirmation).toHaveCount(1);
  await confirmation.getByRole('button', {name: '继续编辑'}).click();
  await expect(page.getByLabel('测试草稿')).toHaveValue('Do not lose this draft');
  await page.getByRole('link', { name: /Synthetic persistent workspace/ }).click();
  await confirmation.getByRole('button', {name: '放弃修改并离开'}).click();
  await expect(page).toHaveURL(new RegExp(`${projectId}$`));
  await expect(page.getByRole('heading', { name: 'Synthetic persistent workspace' })).toBeVisible();
  await expect(confirmation).toHaveCount(0);
});

test('discarding a persistent new-project form resets its dirty state and values', async ({ page }) => {
  await page.goto(root);
  await page.getByRole('button', {name: '新建项目', exact: true}).click();
  await page.getByLabel('项目名称').fill('Unsaved synthetic project');
  await page.getByRole('dialog', {name: '新建项目'}).getByRole('button', {name: 'Close'}).click();
  const confirmation = page.getByRole('alertdialog', {name: '放弃未保存的修改？'});
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', {name: '继续编辑'}).click();
  await expect(page.getByLabel('项目名称')).toHaveValue('Unsaved synthetic project');
  await page.getByRole('dialog', {name: '新建项目'}).getByRole('button', {name: 'Close'}).click();
  await confirmation.getByRole('button', {name: '放弃修改并离开'}).click();
  await page.getByRole('button', {name: '新建项目', exact: true}).click();
  await expect(page.getByLabel('项目名称')).toHaveValue('');
});
