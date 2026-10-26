import { createClient } from 'redis';
import { config } from './config';
import { logger } from './logger';

function createRedisClient(url: string) {
  return createClient({ url, disableOfflineQueue: true });
}

export type RedisClient = ReturnType<typeof createRedisClient>;

export async function connectRedis(url: string = config.REDIS_URL): Promise<RedisClient> {
  const client = createRedisClient(url);
  const firstError = new Promise<never>((_resolve, reject) => client.once('error', reject));
  try {
    await Promise.race([client.connect(), firstError]);
  } catch (err) {
    client.destroy();
    throw new Error('Could not connect to Redis', { cause: err });
  }

  client.on('error', (err: unknown) => logger.error({ err }, 'Redis client error'));
  await client.ping();
  logger.info('Connected to Redis');
  return client;
}
