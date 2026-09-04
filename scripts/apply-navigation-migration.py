from pathlib import Path
import json

for file in ('package.json', 'biome.json'):
    path = Path(file)
    data = json.loads(path.read_text())
    if file == 'package.json':
        data['devDependencies']['@biomejs/biome'] = '2.5.12'
        data['scripts']['build'] = 'pnpm check && pnpm build:remotion && next build'
    else:
        data['$schema'] = 'https://biomejs.dev/schemas/2.5.12/schema.json'
    path.write_text(json.dumps(data, indent=2) + '\n')
path = Path('pnpm-lock.yaml')
text = path.read_text()
old = "'@biomejs/biome':\n        specifier: ^2.5.12"
assert old in text
path.write_text(text.replace(old, "'@biomejs/biome':\n        specifier: 2.5.12", 1))
path = Path('tests/e2e/workspace-navigation.spec.ts')
text = path.read_text()
old = '  await expect(page.getByLabel("测试草稿")).toHaveValue("Do not lose this draft");'
assert old in text
path.write_text(text.replace(old, old + '\n  await expect(page).toHaveURL(new RegExp(`${root}$`));\n  // The non-modal sheet closes when focus moves to the confirmation dialog.\n  await page.getByRole("button", { name: "项目", exact: true }).click();', 1))
path = Path('scripts/test-workspace-navigation.ts')
path.write_text(path.read_text() + '''
const packageConfig = JSON.parse(source("package.json"));
const biomeConfig = JSON.parse(source("biome.json"));
assert.match(packageConfig.devDependencies["@biomejs/biome"], /^\\d+\\.\\d+\\.\\d+$/);
assert.equal(biomeConfig.$schema, `https://biomejs.dev/schemas/${packageConfig.devDependencies["@biomejs/biome"]}/schema.json`);
assert.match(packageConfig.scripts.build, /^pnpm check &&/);
console.log("PASS pinned Biome schema and deployment build quality gate");
''')
