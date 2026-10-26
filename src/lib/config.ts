import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://localhost:6379'),

  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('hotel-offers'),

  SUPPLIER_A_URL: z.url().default('http://localhost:3000/supplierA/hotels'),
  SUPPLIER_B_URL: z.url().default('http://localhost:3000/supplierB/hotels'),

  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  PARTIAL_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),

  ENABLE_MOCK_SUPPLIERS: z.stringbool().default(false),
});

export type Config = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return Object.freeze(result.data);
}

export const config = loadConfig();
