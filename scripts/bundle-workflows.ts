// Pre-bundles workflow code at build time so the production worker loads it via
// `workflowBundle` instead of running webpack on startup.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundleWorkflowCode } from '@temporalio/worker';

const workflowsPath = path.resolve(__dirname, '../src/temporal/workflows.ts');
const outPath = path.resolve(__dirname, '../dist/workflow-bundle.js');

async function main(): Promise<void> {
  const { code } = await bundleWorkflowCode({ workflowsPath });
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, code);
  console.log(`Workflow bundle written to ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
