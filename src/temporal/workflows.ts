import { ActivityFailure, ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import { selectBestOffers } from '../domain/selectBestOffers';
import type { HotelOffer, SupplierName } from '../domain/types';
import type * as activities from './activities';

export interface HotelOffersResult {
  hotels: HotelOffer[];
  failedSuppliers: SupplierName[];
}

// Worst case per supplier is about 7 seconds: 3 attempts of up to 2s (the fetch timeout)
// plus 200ms and 400ms of backoff between them.
const { fetchSupplierHotels } = proxyActivities<typeof activities>({
  startToCloseTimeout: '3 seconds',
  retry: { maximumAttempts: 3, initialInterval: '200ms', backoffCoefficient: 2 },
});

const suppliers: SupplierName[] = ['Supplier A', 'Supplier B'];

function failureMessage(reason: unknown): string {
  if (reason instanceof ActivityFailure && reason.cause) {
    return reason.cause.message;
  }
  return reason instanceof Error ? reason.message : String(reason);
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

  return { hotels: selectBestOffers(offers), failedSuppliers };
}
