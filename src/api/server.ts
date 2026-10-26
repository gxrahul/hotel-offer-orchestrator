import type { Client } from '@temporalio/client';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { config } from '../lib/config';
import { createHotelCache, type HotelCache } from '../lib/hotelCache';
import { logger } from '../lib/logger';
import { connectRedis } from '../lib/redis';
import { connectTemporalClient } from '../temporal/client';
import { healthRouter } from './routes/health';
import { createHotelsRouter } from './routes/hotels';
import { mockSuppliersRouter } from './routes/mockSuppliers';

export interface AppDeps {
  temporalClient: Client;
  hotelCache: HotelCache;
}

export function createApp({ temporalClient, hotelCache }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));

  app.use(healthRouter);
  app.use(mockSuppliersRouter);
  app.use(createHotelsRouter({ temporalClient, hotelCache }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    req.log.error({ err }, 'Unhandled request error');
    res.status(500).json({ error: 'Internal Server Error' });
  };
  app.use(errorHandler);

  return app;
}

async function main(): Promise<void> {
  const redis = await connectRedis();
  const temporalClient = await connectTemporalClient();
  const hotelCache = createHotelCache(redis, {
    fullSeconds: config.CACHE_TTL_SECONDS,
    partialSeconds: config.PARTIAL_CACHE_TTL_SECONDS,
  });

  const server = createApp({ temporalClient, hotelCache }).listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'API server listening');
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'Shutting down API server');
    server.close(() => {
      Promise.all([redis.close(), temporalClient.connection.close()])
        .catch((err: unknown) => logger.error({ err }, 'Error closing connections'))
        .finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    logger.fatal({ err }, 'API server failed to start');
    process.exit(1);
  });
}
