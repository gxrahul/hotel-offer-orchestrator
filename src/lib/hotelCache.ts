import { normalizeHotelName } from '../domain/normalizeHotelName';
import type { HotelOffer, SupplierName } from '../domain/types';
import type { RedisClient } from './redis';

export interface CacheTtls {
  fullSeconds: number;
  partialSeconds: number;
}

export type CacheQueryResult =
  { hit: false } | { hit: true; hotels: HotelOffer[]; failedSuppliers: SupplierName[] };

export interface HotelCache {
  save(
    city: string,
    hotels: HotelOffer[],
    failedSuppliers: SupplierName[],
  ): Promise<{ ttlSeconds: number }>;
  query(city: string, minPrice?: number, maxPrice?: number): Promise<CacheQueryResult>;
}

interface CacheMeta {
  count: number;
  failedSuppliers: SupplierName[];
  savedAt: string;
}

const memberSeparator = '\u0000';

function toMember(hotel: HotelOffer): string {
  return `${normalizeHotelName(hotel.name)}${memberSeparator}${JSON.stringify(hotel)}`;
}

function fromMember(member: string): HotelOffer {
  return JSON.parse(member.slice(member.lastIndexOf(memberSeparator) + 1)) as HotelOffer;
}

function hotelsKey(city: string): string {
  return `hotels:${city}`;
}

function metaKey(city: string): string {
  return `hotels:${city}:meta`;
}

export function createHotelCache(redis: RedisClient, ttls: CacheTtls): HotelCache {
  return {
    async save(city, hotels, failedSuppliers) {
      const ttlSeconds = failedSuppliers.length > 0 ? ttls.partialSeconds : ttls.fullSeconds;
      const meta: CacheMeta = {
        count: hotels.length,
        failedSuppliers,
        savedAt: new Date().toISOString(),
      };

      const transaction = redis.multi();
      transaction.del(hotelsKey(city));
      if (hotels.length > 0) {
        transaction.zAdd(
          hotelsKey(city),
          hotels.map((hotel) => ({ score: hotel.price, value: toMember(hotel) })),
        );
        transaction.expire(hotelsKey(city), ttlSeconds);
      }
      transaction.set(metaKey(city), JSON.stringify(meta), {
        expiration: { type: 'EX', value: ttlSeconds },
      });
      await transaction.exec();

      return { ttlSeconds };
    },

    async query(city, minPrice, maxPrice) {
      const [metaJson, members] = await redis
        .multi()
        .get(metaKey(city))
        .zRange(hotelsKey(city), minPrice ?? '-inf', maxPrice ?? '+inf', { BY: 'SCORE' })
        .execTyped();

      if (metaJson === null) {
        return { hit: false };
      }
      const meta = JSON.parse(metaJson) as CacheMeta;
      return {
        hit: true,
        hotels: members.map(fromMember),
        failedSuppliers: meta.failedSuppliers,
      };
    },
  };
}
