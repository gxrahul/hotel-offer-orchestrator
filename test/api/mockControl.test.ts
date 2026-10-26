import type { Client } from '@temporalio/client';
import request from 'supertest';
import type { HealthChecks } from '../../src/api/health';
import { createApp } from '../../src/api/server';
import type { HotelCache } from '../../src/lib/hotelCache';

const up = () => Promise.resolve();
const healthChecks: HealthChecks = { supplierA: up, supplierB: up, redis: up, temporal: up };

function setup(enableMockSuppliers = true) {
  const clearAll = jest.fn<Promise<number>, []>().mockResolvedValue(2);
  const hotelCache: HotelCache = { save: jest.fn(), query: jest.fn(), clearAll };
  const temporalClient = { workflow: { execute: jest.fn() } } as unknown as Client;
  const app = createApp({ temporalClient, hotelCache, healthChecks, enableMockSuppliers });
  return { app, clearAll };
}

describe('mock supplier control', () => {
  it('does not mount the mock supplier or control routes when disabled', async () => {
    const { app, clearAll } = setup(false);

    expect((await request(app).get('/supplierA/hotels?city=delhi')).status).toBe(404);
    expect((await request(app).get('/supplierB/hotels?city=delhi')).status).toBe(404);
    expect((await request(app).post('/mock/suppliers/reset')).status).toBe(404);
    expect((await request(app).post('/mock/suppliers/a/state').send({ mode: 'down' })).status).toBe(
      404,
    );
    expect(clearAll).not.toHaveBeenCalled();
  });

  it('makes a supplier return 503 when down and normal data when up again', async () => {
    const { app } = setup();

    const down = await request(app).post('/mock/suppliers/B/state').send({ mode: 'down' });
    expect(down.status).toBe(200);
    expect(down.body).toEqual({ a: 'up', b: 'down' });

    const whileDown = await request(app).get('/supplierB/hotels?city=delhi');
    expect(whileDown.status).toBe(503);
    expect(whileDown.body).toEqual({ error: 'Supplier unavailable' });
    expect((await request(app).get('/supplierA/hotels?city=delhi')).status).toBe(200);

    await request(app).post('/mock/suppliers/b/state').send({ mode: 'up' });

    const afterUp = await request(app).get('/supplierB/hotels?city=delhi');
    expect(afterUp.status).toBe(200);
    expect(afterUp.body).toHaveLength(4);
  });

  it('rejects an unknown supplier id with 400', async () => {
    const { app, clearAll } = setup();

    const res = await request(app).post('/mock/suppliers/c/state').send({ mode: 'down' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unknown supplier id "c", use "a" or "b"' });
    expect(clearAll).not.toHaveBeenCalled();
  });

  it.each([{ mode: 'sideways' }, {}, undefined])('rejects body %p with 400', async (body) => {
    const { app, clearAll } = setup();

    const res = await request(app).post('/mock/suppliers/a/state').send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'mode must be "up" or "down"' });
    expect(clearAll).not.toHaveBeenCalled();
  });

  it('resets both suppliers to up', async () => {
    const { app } = setup();
    await request(app).post('/mock/suppliers/a/state').send({ mode: 'down' });
    await request(app).post('/mock/suppliers/b/state').send({ mode: 'down' });

    const res = await request(app).post('/mock/suppliers/reset');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ a: 'up', b: 'up' });
    expect((await request(app).get('/supplierA/hotels')).status).toBe(200);
    expect((await request(app).get('/supplierB/hotels')).status).toBe(200);
  });

  it('clears the hotel cache on every state change', async () => {
    const { app, clearAll } = setup();

    await request(app).post('/mock/suppliers/a/state').send({ mode: 'down' });
    await request(app).post('/mock/suppliers/a/state').send({ mode: 'up' });
    await request(app).post('/mock/suppliers/reset');

    expect(clearAll).toHaveBeenCalledTimes(3);
  });
});
