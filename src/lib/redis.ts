import { createClient } from 'redis';
import { config } from './config';
import { logger } from './logger';

function createRedisClient(url: string) {
  return createClient({ url });
}

export type RedisClient = ReturnType<typeof createRedisClient>;

export async function connectRedis(url: string = config.REDIS_URL): Promise<RedisClient> {
  const client = createRedisClient(url);
  client.on('error', (err: unknown) => logger.error({ err }, 'Redis client error'));
  await client.connect();
  await client.ping();
  logger.info('Connected to Redis');
  return client;
}
