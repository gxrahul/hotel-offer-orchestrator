import type { Client } from '@temporalio/client';
import type { Config } from '../lib/config';
import type { RedisClient } from '../lib/redis';

export const healthCheckTimeoutMs = 1000;

export type HealthCheck = () => Promise<void>;

export interface HealthChecks {
  supplierA: HealthCheck;
  supplierB: HealthCheck;
  redis: HealthCheck;
  temporal: HealthCheck;
}

export type CheckResult =
  { status: 'up'; latencyMs: number } | { status: 'down'; error: string; latencyMs: number };

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  suppliers: { 'Supplier A': CheckResult; 'Supplier B': CheckResult };
  redis: CheckResult;
  temporal: CheckResult;
}

function supplierCheck(url: string): HealthCheck {
  return async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(healthCheckTimeoutMs) });
    await response.body?.cancel();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  };
}

export function createHealthChecks(deps: {
  config: Pick<Config, 'SUPPLIER_A_URL' | 'SUPPLIER_B_URL'>;
  redis: RedisClient;
  temporalClient: Client;
}): HealthChecks {
  return {
    supplierA: supplierCheck(deps.config.SUPPLIER_A_URL),
    supplierB: supplierCheck(deps.config.SUPPLIER_B_URL),
    redis: async () => {
      await deps.redis.ping();
    },
    temporal: async () => {
      await deps.temporalClient.connection.workflowService.getSystemInfo({});
    },
  };
}

function describeError(err: unknown): string {
  const error = err as { name?: unknown; message?: unknown; cause?: { code?: unknown } } | null;
  if (error?.name === 'TimeoutError') {
    return 'timeout';
  }
  if (error?.cause?.code === 'ECONNREFUSED') {
    return 'connection refused';
  }
  return typeof error?.message === 'string' && error.message ? error.message : 'unknown error';
}

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runCheck(check: HealthCheck, timeoutMs: number): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    await withTimeout(check(), timeoutMs);
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { status: 'down', error: describeError(err), latencyMs: Date.now() - startedAt };
  }
}

export async function getHealthReport(
  checks: HealthChecks,
  timeoutMs: number = healthCheckTimeoutMs,
): Promise<HealthReport> {
  const [supplierA, supplierB, redis, temporal] = await Promise.all([
    runCheck(checks.supplierA, timeoutMs),
    runCheck(checks.supplierB, timeoutMs),
    runCheck(checks.redis, timeoutMs),
    runCheck(checks.temporal, timeoutMs),
  ]);

  const bothSuppliersDown = supplierA.status === 'down' && supplierB.status === 'down';
  const anyDown = [supplierA, supplierB, redis, temporal].some((r) => r.status === 'down');

  let status: HealthReport['status'] = 'ok';
  if (bothSuppliersDown || temporal.status === 'down') {
    status = 'down';
  } else if (anyDown) {
    status = 'degraded';
  }

  return {
    status,
    suppliers: { 'Supplier A': supplierA, 'Supplier B': supplierB },
    redis,
    temporal,
  };
}
