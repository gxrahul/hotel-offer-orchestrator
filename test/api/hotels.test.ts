import { ApplicationFailure, WorkflowFailedError, type Client } from '@temporalio/client';
import request from 'supertest';
import { createApp } from '../../src/api/server';
import type { HotelOffer } from '../../src/domain/types';
import type { CacheQueryResult, HotelCache } from '../../src/lib/hotelCache';
import type { HotelOffersResult } from '../../src/temporal/workflows';

const delhiHotels: HotelOffer[] = [
  { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
  { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
  { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
];

const filteredHotels = delhiHotels.slice(1);

function setup() {
  const execute = jest.fn<Promise<HotelOffersResult>, unknown[]>();
  const query = jest.fn<Promise<CacheQueryResult>, Parameters<HotelCache['query']>>();
  const hotelCache: HotelCache = { save: jest.fn(), query };
  const temporalClient = { workflow: { execute } } as unknown as Client;
  const app = createApp({ temporalClient, hotelCache });
  return { app, execute, query };
}

describe('GET /api/hotels', () => {
  it('runs a fresh search without a price filter (BYPASS)', async () => {
    const { app, execute, query } = setup();
    execute.mockResolvedValue({ hotels: delhiHotels, failedSuppliers: [], cached: true });

    const res = await request(app).get('/api/hotels?city=%20Delhi%20');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('BYPASS');
    expect(res.headers['x-partial-results']).toBeUndefined();
    expect(res.body).toEqual(delhiHotels);
    expect(execute).toHaveBeenCalledWith(
      'hotelOffersWorkflow',
      expect.objectContaining({ args: ['delhi'], workflowExecutionTimeout: '30 seconds' }),
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('sets X-Partial-Results from the workflow result', async () => {
    const { app, execute } = setup();
    execute.mockResolvedValue({
      hotels: delhiHotels,
      failedSuppliers: ['Supplier B'],
      cached: true,
    });

    const res = await request(app).get('/api/hotels?city=delhi');

    expect(res.headers['x-partial-results']).toBe('Supplier B');
  });

  it('serves a filtered request from the cache without starting a workflow (HIT)', async () => {
    const { app, execute, query } = setup();
    query.mockResolvedValue({ hit: true, hotels: filteredHotels, failedSuppliers: [] });

    const res = await request(app).get('/api/hotels?city=delhi&minPrice=5000&maxPrice=9000');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('HIT');
    expect(res.body).toEqual(filteredHotels);
    expect(query).toHaveBeenCalledWith('delhi', 5000, 9000);
    expect(execute).not.toHaveBeenCalled();
  });

  it('sets X-Partial-Results from the cache meta on a hit', async () => {
    const { app, query } = setup();
    query.mockResolvedValue({ hit: true, hotels: filteredHotels, failedSuppliers: ['Supplier A'] });

    const res = await request(app).get('/api/hotels?city=delhi&minPrice=5000');

    expect(res.headers['x-partial-results']).toBe('Supplier A');
    expect(query).toHaveBeenCalledWith('delhi', 5000, undefined);
  });

  it('runs the workflow and queries again on a cache miss (MISS)', async () => {
    const { app, execute, query } = setup();
    query
      .mockResolvedValueOnce({ hit: false })
      .mockResolvedValueOnce({ hit: true, hotels: filteredHotels, failedSuppliers: [] });
    execute.mockResolvedValue({ hotels: delhiHotels, failedSuppliers: [], cached: true });

    const res = await request(app).get('/api/hotels?city=delhi&maxPrice=9000');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.body).toEqual(filteredHotels);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith('delhi', undefined, 9000);
  });

  it.each([
    ['non-numeric', 'city=delhi&minPrice=abc'],
    ['empty', 'city=delhi&minPrice='],
    ['negative', 'city=delhi&maxPrice=-1'],
    ['infinite', 'city=delhi&maxPrice=Infinity'],
    ['repeated', 'city=delhi&minPrice=1&minPrice=2'],
    ['min > max', 'city=delhi&minPrice=9000&maxPrice=5000'],
    ['missing city', 'minPrice=100'],
    ['blank city', 'city=%20%20'],
  ])('rejects %s query parameters with 400', async (_case, queryString) => {
    const { app, execute, query } = setup();

    const res = await request(app).get(`/api/hotels?${queryString}`);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Invalid query parameters' });
    expect(execute).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 503 when the workflow could not cache the result', async () => {
    const { app, execute, query } = setup();
    query.mockResolvedValue({ hit: false });
    execute.mockResolvedValue({ hotels: delhiHotels, failedSuppliers: [], cached: false });

    const res = await request(app).get('/api/hotels?city=delhi&minPrice=5000');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Price filtering is temporarily unavailable' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when Redis is unreachable', async () => {
    const { app, execute, query } = setup();
    query.mockRejectedValue(new Error('The client is closed'));

    const res = await request(app).get('/api/hotels?city=delhi&minPrice=5000');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Price filtering is temporarily unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns 502 when all suppliers are down', async () => {
    const { app, execute } = setup();
    execute.mockRejectedValue(
      new WorkflowFailedError(
        'Workflow execution failed',
        ApplicationFailure.nonRetryable('All suppliers failed', 'SUPPLIERS_DOWN'),
        'NON_RETRYABLE_FAILURE',
      ),
    );

    const res = await request(app).get('/api/hotels?city=delhi');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'All suppliers are unavailable' });
  });

  it('returns 500 for any other workflow error', async () => {
    const { app, execute } = setup();
    execute.mockRejectedValue(new Error('Temporal is unreachable'));

    const res = await request(app).get('/api/hotels?city=delhi');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
  });
});
