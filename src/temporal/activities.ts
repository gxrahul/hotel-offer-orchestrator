import { ApplicationFailure, log } from '@temporalio/activity';
import { z } from 'zod';
import { normalizeHotelName } from '../domain/normalizeHotelName';
import type { HotelOffer, SupplierHotel, SupplierName } from '../domain/types';
import { config } from '../lib/config';

const supplierHotelsSchema = z.array(
  z.object({
    hotelId: z.string(),
    name: z.string(),
    price: z.number(),
    city: z.string(),
    commissionPct: z.number(),
  }),
);

const supplierUrls: Record<SupplierName, string> = {
  'Supplier A': config.SUPPLIER_A_URL,
  'Supplier B': config.SUPPLIER_B_URL,
};

function parseHotels(supplier: SupplierName, body: string): SupplierHotel[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw ApplicationFailure.nonRetryable(`${supplier} returned invalid JSON`, 'INVALID_RESPONSE');
  }

  const result = supplierHotelsSchema.safeParse(json);
  if (!result.success) {
    throw ApplicationFailure.nonRetryable(
      `${supplier} returned an unexpected response shape: ${z.prettifyError(result.error)}`,
      'INVALID_RESPONSE',
    );
  }
  return result.data;
}

function warnAboutDuplicateNames(supplier: SupplierName, city: string, hotels: SupplierHotel[]) {
  const hotelIdsByName = new Map<string, string[]>();
  for (const hotel of hotels) {
    const normalizedName = normalizeHotelName(hotel.name);
    hotelIdsByName.set(normalizedName, [
      ...(hotelIdsByName.get(normalizedName) ?? []),
      hotel.hotelId,
    ]);
  }

  for (const [normalizedName, hotelIds] of hotelIdsByName) {
    if (hotelIds.length > 1) {
      log.warn('Duplicate hotel name in supplier response', {
        supplier,
        city,
        normalizedName,
        count: hotelIds.length,
        hotelIds,
      });
    }
  }
}

export async function fetchSupplierHotels(
  supplier: SupplierName,
  city: string,
): Promise<HotelOffer[]> {
  const url = new URL(supplierUrls[supplier]);
  url.searchParams.set('city', city);

  const startedAt = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  const body = await response.text();
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    log.warn('Supplier request failed', { supplier, city, status: response.status, durationMs });
    const message = `${supplier} responded with HTTP ${response.status}`;
    if (response.status >= 500) {
      throw new Error(message);
    }
    throw ApplicationFailure.nonRetryable(message, 'SUPPLIER_CLIENT_ERROR');
  }

  const hotels = parseHotels(supplier, body);
  log.info('Supplier responded', {
    supplier,
    city,
    status: response.status,
    durationMs,
    hotelCount: hotels.length,
  });
  warnAboutDuplicateNames(supplier, city, hotels);

  return hotels.map((hotel) => ({
    name: hotel.name,
    price: hotel.price,
    supplier,
    commissionPct: hotel.commissionPct,
  }));
}
