import { ActivityFailure, ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import { selectBestOffers } from '../domain/selectBestOffers';
import type { HotelOffer, SupplierName } from '../domain/types';
import type { Activities } from './activities';

export interface HotelOffersResult {
  hotels: HotelOffer[];
  failedSuppliers: SupplierName[];
  cached: boolean;
}

// Worst case per supplier is about 7 seconds: 3 attempts of up to 2s (the fetch timeout)
// plus 200ms and 400ms of backoff between them.
const { fetchSupplierHotels } = proxyActivities<Activities>({
  startToCloseTimeout: '3 seconds',
  retry: { maximumAttempts: 3, initialInterval: '200ms', backoffCoefficient: 2 },
});

const { saveHotelOffers } = proxyActivities<Activities>({
  startToCloseTimeout: '3 seconds',
  retry: { maximumAttempts: 3 },
});

const suppliers: SupplierName[] = ['Supplier A', 'Supplier B'];

function failureMessage(reason: unknown): string {
  if (reason instanceof ActivityFailure && reason.cause) {
    return reason.cause.message;
  }
  return reason instanceof Error ? reason.message : String(reason);
}

async function saveToCache(
  city: string,
  hotels: HotelOffer[],
  failedSuppliers: SupplierName[],
): Promise<boolean> {
  try {
    await saveHotelOffers(city, hotels, failedSuppliers);
    return true;
  } catch (err) {
    log.error('Saving hotel offers to cache failed, returning them uncached', {
      city,
      error: failureMessage(err),
    });
    return false;
  }
}

export async function hotelOffersWorkflow(city: string): Promise<HotelOffersResult> {
  const results = await Promise.allSettled(
    suppliers.map((supplier) => fetchSupplierHotels(supplier, city)),
  );

  const offers: HotelOffer[] = [];
  const failedSuppliers: SupplierName[] = [];
  suppliers.forEach((supplier, index) => {
    const result = results[index];
    if (result?.status === 'fulfilled') {
      offers.push(...result.value);
    } else {
      failedSuppliers.push(supplier);
      log.warn('Supplier failed, continuing without it', {
        supplier,
        city,
        error: failureMessage(result?.reason),
      });
    }
  });

  if (failedSuppliers.length === suppliers.length) {
    throw ApplicationFailure.nonRetryable('All suppliers failed', 'SUPPLIERS_DOWN');
  }

  const hotels = selectBestOffers(offers);
  const cached = await saveToCache(city, hotels, failedSuppliers);

  return { hotels, failedSuppliers, cached };
}
