import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(scriptDir, '../../.github/workflows/pages.yml');

let source;
try {
  source = await readFile(workflowPath, 'utf8');
} catch (error) {
  if (error && error.code === 'ENOENT') {
    throw new Error(`GitHub Pages workflow is missing: ${workflowPath}`);
  }
  throw error;
}

const workflow = parse(source);
assert.equal(workflow.permissions?.contents, 'read', 'contents permission must be read');
assert.equal(workflow.permissions?.pages, 'write', 'pages permission must be write');
assert.equal(workflow.permissions?.['id-token'], 'write', 'id-token permission must be write');

const build = workflow.jobs?.build;
const deploy = workflow.jobs?.deploy;
assert.ok(build, 'build job is required');
assert.ok(deploy, 'deploy job is required');
assert.equal(build.defaults?.run?.['working-directory'], 'site', 'build commands must run in site/');

const buildSteps = Array.isArray(build.steps) ? build.steps : [];
const commands = buildSteps.map((step) => step.run).filter(Boolean);
assert.ok(commands.includes('npm ci'), 'build job must install locked dependencies');
assert.ok(commands.includes('npm test -- --run'), 'build job must run the test suite');
assert.ok(commands.includes('python3 scripts/test-bridge.py'), 'build job must run the Python bridge smoke test');
assert.ok(commands.includes('npm run build'), 'build job must create the production bundle');

const engineStep = buildSteps.find((step) => step.name === 'Run Python engine regressions');
assert.ok(engineStep, 'Python engine regression step is required');
assert.equal(engineStep['working-directory'], '.', 'engine regressions must run from the repository root');
// 개별 테스트 모듈이 아니라 discover를 요구한다 — 모듈을 하나씩 적으면 새 테스트
// 파일이 CI에서 조용히 빠진다(실제로 로스터 배치 12개가 그럴 뻔했다).
for (const command of [
  "python3 -m unittest discover -s calculator -p 'test_*.py' -v",
  'python3 calculator/damage.py',
  'python3 -m context.doclint',
  'python3 -m context.snapshot',
]) {
  assert.ok(engineStep.run?.includes(command), `engine regressions must include: ${command}`);
}

const uses = buildSteps.map((step) => step.uses).filter(Boolean);
assert.ok(uses.some((value) => value.startsWith('actions/configure-pages@')), 'configure-pages action is required');
const upload = buildSteps.find((step) => step.uses?.startsWith('actions/upload-pages-artifact@'));
assert.ok(upload, 'upload-pages-artifact action is required');
assert.equal(upload.with?.path, 'site/dist', 'Pages artifact must use site/dist');

const deploySteps = Array.isArray(deploy.steps) ? deploy.steps : [];
assert.ok(
  deploySteps.some((step) => step.uses?.startsWith('actions/deploy-pages@')),
  'deploy-pages action is required',
);
assert.equal(deploy.needs, 'build', 'deploy job must wait for build');

console.log('GitHub Pages workflow: OK');
