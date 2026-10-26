import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { pingActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
});

export async function pingWorkflow(): Promise<string> {
  return pingActivity();
}
