import { randomUUID } from 'node:crypto';
import { selectBestOffers } from '../../src/domain/selectBestOffers';
import type { HotelOffer } from '../../src/domain/types';
import { createHotelCache, type HotelCache } from '../../src/lib/hotelCache';
import { connectRedis, type RedisClient } from '../../src/lib/redis';

const delhiHotels: HotelOffer[] = [
  { name: 'Taj Palace', price: 9000, supplier: 'Supplier A', commissionPct: 15 },
  { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
  { name: 'The Oberoi', price: 11000, supplier: 'Supplier A', commissionPct: 18 },
  { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
  { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
];

function names(result: Awaited<ReturnType<HotelCache['query']>>): string[] {
  if (!result.hit) {
    throw new Error('Expected a cache hit');
  }
  return result.hotels.map((hotel) => hotel.name);
}

describe('hotelCache (Redis)', () => {
  let redis: RedisClient;
  let cache: HotelCache;
  const cities: string[] = [];

  function newCity(): string {
    const city = `test-${randomUUID()}`;
    cities.push(city);
    return city;
  }

  beforeAll(async () => {
    redis = await connectRedis();
    cache = createHotelCache(redis, { fullSeconds: 300, partialSeconds: 30 });
  });

  afterAll(async () => {
    const keys = cities.flatMap((city) => [`hotels:${city}`, `hotels:${city}:meta`]);
    if (keys.length > 0) {
      await redis.del(keys);
    }
    await redis.close();
  });

  it('returns every saved hotel in price order', async () => {
    const city = newCity();
    await cache.save(city, delhiHotels, []);

    const result = await cache.query(city);

    expect(result).toEqual({
      hit: true,
      hotels: [...delhiHotels].sort((a, b) => a.price - b.price),
      failedSuppliers: [],
    });
  });

  it('filters by minPrice only', async () => {
    const city = newCity();
    await cache.save(city, delhiHotels, []);

    expect(names(await cache.query(city, 9000))).toEqual(['Taj Palace', 'The Oberoi']);
  });

  it('filters by maxPrice only', async () => {
    const city = newCity();
    await cache.save(city, delhiHotels, []);

    expect(names(await cache.query(city, undefined, 5000))).toEqual(['Lemon Tree']);
  });

  it('filters by minPrice and maxPrice', async () => {
    const city = newCity();
    await cache.save(city, delhiHotels, []);

    expect(names(await cache.query(city, 5000, 9000))).toEqual(['Holtin', 'Radison', 'Taj Palace']);
  });

  it('orders equal prices by normalized name, like selectBestOffers', async () => {
    const city = newCity();
    const samePrice: HotelOffer[] = [
      { name: 'Zen', price: 4000, supplier: 'Supplier A', commissionPct: 10 },
      { name: 'alpine', price: 4000, supplier: 'Supplier B', commissionPct: 10 },
    ];
    await cache.save(city, samePrice, []);

    const cachedNames = names(await cache.query(city));

    expect(cachedNames).toEqual(['alpine', 'Zen']);
    expect(cachedNames).toEqual(selectBestOffers(samePrice).map((hotel) => hotel.name));
  });

  it('treats both bounds as inclusive', async () => {
    const city = newCity();
    await cache.save(city, delhiHotels, []);

    expect(names(await cache.query(city, 9000, 9000))).toEqual(['Taj Palace']);
  });

  it('treats a saved empty list as a hit', async () => {
    const city = newCity();
    await cache.save(city, [], []);

    expect(await cache.query(city, 0)).toEqual({ hit: true, hotels: [], failedSuppliers: [] });
  });

  it('reports a miss for a city that was never saved', async () => {
    expect(await cache.query(newCity())).toEqual({ hit: false });
  });

  it('replaces the previous list on a second save', async () => {
    const city = newCity();
    await cache.save(city, delhiHotels, []);
    await cache.save(city, [delhiHotels[1]!], ['Supplier A']);

    expect(await cache.query(city)).toEqual({
      hit: true,
      hotels: [delhiHotels[1]],
      failedSuppliers: ['Supplier A'],
    });
  });

  it('clearAll deletes every hotels:* key and nothing else', async () => {
    const unrelatedKey = `other:${randomUUID()}`;
    await redis.set(unrelatedKey, 'keep me');
    const [firstCity, secondCity] = [newCity(), newCity()];
    await cache.save(firstCity, delhiHotels, []);
    await cache.save(secondCity, [], []);

    const deletedKeys = await cache.clearAll();

    expect(deletedKeys).toBeGreaterThanOrEqual(3);
    expect(await redis.keys('hotels:*')).toEqual([]);
    expect(await cache.query(firstCity)).toEqual({ hit: false });
    expect(await redis.get(unrelatedKey)).toBe('keep me');
    await redis.del(unrelatedKey);
  });

  it('uses the full TTL for a complete result', async () => {
    const city = newCity();
    const { ttlSeconds } = await cache.save(city, delhiHotels, []);

    expect(ttlSeconds).toBe(300);
    for (const key of [`hotels:${city}`, `hotels:${city}:meta`]) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(290);
      expect(ttl).toBeLessThanOrEqual(300);
    }
  });

  it('uses the short TTL for a partial result', async () => {
    const city = newCity();
    const { ttlSeconds } = await cache.save(city, delhiHotels, ['Supplier B']);

    expect(ttlSeconds).toBe(30);
    for (const key of [`hotels:${city}`, `hotels:${city}:meta`]) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(20);
      expect(ttl).toBeLessThanOrEqual(30);
    }
  });
});
