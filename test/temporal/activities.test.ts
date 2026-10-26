import { ApplicationFailure } from '@temporalio/activity';
import { MockActivityEnvironment } from '@temporalio/testing';
import { DefaultLogger, type LogEntry } from '@temporalio/worker';
import type { SupplierName } from '../../src/domain/types';
import type { HotelCache } from '../../src/lib/hotelCache';
import { createActivities } from '../../src/temporal/activities';

const fakeHotelCache: HotelCache = {
  save: () => Promise.resolve({ ttlSeconds: 300 }),
  query: () => Promise.resolve({ hit: false }),
  clearAll: () => Promise.resolve(0),
};

const { fetchSupplierHotels } = createActivities({
  hotelCache: fakeHotelCache,
  config: {
    SUPPLIER_A_URL: 'http://localhost:3000/supplierA/hotels',
    SUPPLIER_B_URL: 'http://localhost:3000/supplierB/hotels',
  },
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function isRetryable(err: unknown): boolean {
  return !(err instanceof ApplicationFailure && err.nonRetryable);
}

describe('fetchSupplierHotels', () => {
  let logEntries: LogEntry[];
  let env: MockActivityEnvironment;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    logEntries = [];
    env = new MockActivityEnvironment(undefined, {
      logger: new DefaultLogger('TRACE', (entry) => logEntries.push(entry)),
    });
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  function runActivity(supplier: SupplierName, city: string) {
    return env.run(fetchSupplierHotels, supplier, city);
  }

  async function runActivityExpectingError(supplier: SupplierName, city: string): Promise<unknown> {
    try {
      await runActivity(supplier, city);
    } catch (err) {
      return err;
    }
    throw new Error('Expected the activity to fail');
  }

  function requestedUrl(): URL {
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    return url as URL;
  }

  it('maps supplier hotels to offers with the supplier name', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
        { hotelId: 'b4', name: 'Lemon Tree', price: 3500, city: 'delhi', commissionPct: 8 },
      ]),
    );

    const offers = await runActivity('Supplier B', 'delhi');

    expect(offers).toEqual([
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
    ]);
    expect(requestedUrl().href).toBe('http://localhost:3000/supplierB/hotels?city=delhi');
  });

  it('URL-encodes the city', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await runActivity('Supplier A', 'new delhi&x=1');

    expect(requestedUrl().searchParams.get('city')).toBe('new delhi&x=1');
  });

  it('throws a retryable error on HTTP 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));

    const err = await runActivityExpectingError('Supplier A', 'delhi');

    expect(err).toBeInstanceOf(Error);
    expect(isRetryable(err)).toBe(true);
  });

  it('throws a non-retryable ApplicationFailure on HTTP 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'not found' }, 404));

    const err = await runActivityExpectingError('Supplier A', 'delhi');

    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(isRetryable(err)).toBe(false);
  });

  it('throws a non-retryable ApplicationFailure on an invalid body shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ hotelId: 'a1', name: 'Holtin', price: 'cheap' }]));

    const err = await runActivityExpectingError('Supplier A', 'delhi');

    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(isRetryable(err)).toBe(false);
  });

  it('throws a retryable error when the request times out', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        }),
    );

    const err = await runActivityExpectingError('Supplier A', 'delhi');

    expect(err).toHaveProperty('name', 'TimeoutError');
    expect(isRetryable(err)).toBe(true);
  });

  it('logs one warning per duplicate name and still returns every offer', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
        { hotelId: 'a7', name: 'holtin ', price: 5800, city: 'delhi', commissionPct: 11 },
        { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
      ]),
    );

    const offers = await runActivity('Supplier A', 'delhi');

    expect(offers).toHaveLength(3);
    const warnings = logEntries.filter((entry) => entry.level === 'WARN');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.meta).toMatchObject({
      supplier: 'Supplier A',
      city: 'delhi',
      normalizedName: 'holtin',
      count: 2,
      hotelIds: ['a1', 'a7'],
    });
  });
});
