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
assert.ok(commands.includes('npx tsx scripts/snapshot.ts'), 'build job must run the golden damage regressions');
assert.ok(commands.includes('npm run build'), 'build job must create the production bundle');

// 엔진 단위 테스트는 `npm test`(vitest)가 site/src/engine/tests/를 통째로 돈다 — 모듈을 하나씩 적지
// 않으므로 새 테스트 파일이 CI에서 조용히 빠지지 않는다.
const docStep = buildSteps.find((step) => step.name === 'Check docs against data and engine');
assert.ok(docStep, 'doclint step is required');
assert.equal(docStep['working-directory'], '.', 'doclint must run from the repository root');
assert.ok(docStep.run?.includes('python3 -m context.doclint'), 'doclint step must run context.doclint');

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
