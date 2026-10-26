import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DefaultLogger,
  NativeConnection,
  Runtime,
  Worker,
  type LogLevel,
  type WorkerOptions,
} from '@temporalio/worker';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import * as activities from './activities';

const pinoLevels: Record<LogLevel, 'trace' | 'debug' | 'info' | 'warn' | 'error'> = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

function installTemporalLogger(): void {
  Runtime.install({
    logger: new DefaultLogger('TRACE', ({ level, message, meta }) => {
      const { taskToken: _taskToken, ...fields } = meta ?? {};
      logger[pinoLevels[level]](fields, message);
    }),
  });
}

const useBundle = config.NODE_ENV === 'production';
const bundlePath = path.resolve(__dirname, '../workflow-bundle.js');

const workflowSource: Pick<WorkerOptions, 'workflowBundle' | 'workflowsPath'> = useBundle
  ? { workflowBundle: { codePath: bundlePath } }
  : { workflowsPath: require.resolve('./workflows') };

async function main(): Promise<void> {
  if (useBundle && !existsSync(bundlePath)) {
    throw new Error(
      `Workflow bundle not found at ${bundlePath}. Run "npm run build" to create it ` +
        '(or unset NODE_ENV=production to bundle workflows from source).',
    );
  }

  installTemporalLogger();
  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  try {
    const worker = await Worker.create({
      connection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      ...workflowSource,
      activities,
    });
    logger.info(
      { taskQueue: config.TEMPORAL_TASK_QUEUE, workflowSource: useBundle ? 'bundle' : 'source' },
      'Temporal worker started',
    );
    await worker.run();
    logger.info('Temporal worker stopped');
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Temporal worker failed');
  process.exit(1);
});
