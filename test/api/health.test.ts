import type { Client } from '@temporalio/client';
import request from 'supertest';
import type { HealthCheck, HealthChecks, HealthReport } from '../../src/api/health';
import { createApp } from '../../src/api/server';
import type { HotelCache } from '../../src/lib/hotelCache';

const up: HealthCheck = () => Promise.resolve();
const downWith =
  (message: string): HealthCheck =>
  () =>
    Promise.reject(new Error(message));

function setup(overrides: Partial<HealthChecks> = {}) {
  const checks: HealthChecks = {
    supplierA: jest.fn(up),
    supplierB: jest.fn(up),
    redis: jest.fn(up),
    temporal: jest.fn(up),
    ...overrides,
  };
  const hotelCache: HotelCache = { save: jest.fn(), query: jest.fn(), clearAll: jest.fn() };
  const temporalClient = { workflow: { execute: jest.fn() } } as unknown as Client;
  const app = createApp({
    temporalClient,
    hotelCache,
    healthChecks: checks,
    enableMockSuppliers: false,
  });
  return { app, checks };
}

async function getHealth(app: ReturnType<typeof setup>['app']) {
  const res = await request(app).get('/health');
  return { status: res.status, report: res.body as HealthReport };
}

describe('GET /health', () => {
  it('reports ok with 200 when everything is up', async () => {
    const { app } = setup();

    const { status, report } = await getHealth(app);

    expect(status).toBe(200);
    expect(report.status).toBe('ok');
    for (const result of [
      report.suppliers['Supplier A'],
      report.suppliers['Supplier B'],
      report.redis,
      report.temporal,
    ]) {
      expect(result.status).toBe('up');
      expect(typeof result.latencyMs).toBe('number');
    }
  });

  it('reports degraded with 200 when one supplier is down', async () => {
    const { app } = setup({ supplierB: downWith('HTTP 503') });

    const { status, report } = await getHealth(app);

    expect(status).toBe(200);
    expect(report.status).toBe('degraded');
    expect(report.suppliers['Supplier A']).toMatchObject({ status: 'up' });
    expect(report.suppliers['Supplier B']).toMatchObject({ status: 'down', error: 'HTTP 503' });
  });

  it('reports down with 503 when both suppliers are down', async () => {
    const { app } = setup({ supplierA: downWith('HTTP 503'), supplierB: downWith('HTTP 503') });

    const { status, report } = await getHealth(app);

    expect(status).toBe(503);
    expect(report.status).toBe('down');
  });

  it('reports down with 503 when Temporal is down', async () => {
    const { app } = setup({ temporal: downWith('14 UNAVAILABLE: No connection established') });

    const { status, report } = await getHealth(app);

    expect(status).toBe(503);
    expect(report.status).toBe('down');
    expect(report.temporal).toMatchObject({ status: 'down' });
  });

  it('reports degraded with 200 when Redis is down', async () => {
    const { app } = setup({ redis: downWith('The client is closed') });

    const { status, report } = await getHealth(app);

    expect(status).toBe(200);
    expect(report.status).toBe('degraded');
    expect(report.redis).toMatchObject({ status: 'down', error: 'The client is closed' });
  });

  it('reports connection refused for a refused connection', async () => {
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), {
        code: 'ECONNREFUSED',
      }),
    });
    const { app } = setup({ supplierA: () => Promise.reject(refused) });

    const { report } = await getHealth(app);

    expect(report.suppliers['Supplier A']).toMatchObject({
      status: 'down',
      error: 'connection refused',
    });
  });

  it('reports a check that never resolves as a timeout within about 1.5s', async () => {
    const { app } = setup({ supplierA: () => new Promise<void>(() => {}) });

    const startedAt = Date.now();
    const { status, report } = await getHealth(app);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1500);
    expect(status).toBe(200);
    expect(report.status).toBe('degraded');
    expect(report.suppliers['Supplier A']).toMatchObject({ status: 'down', error: 'timeout' });
  });
});

describe('GET /livez', () => {
  it('returns 200 without running any check', async () => {
    const { app, checks } = setup();

    const res = await request(app).get('/livez');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    for (const check of Object.values(checks)) {
      expect(check).not.toHaveBeenCalled();
    }
  });
});
