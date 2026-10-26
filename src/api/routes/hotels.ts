import { randomUUID } from 'node:crypto';
import { ApplicationFailure, WorkflowFailedError, type Client } from '@temporalio/client';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { HotelOffer, SupplierName } from '../../domain/types';
import { config } from '../../lib/config';
import type { CacheQueryResult, HotelCache } from '../../lib/hotelCache';
import type { HotelOffersResult, hotelOffersWorkflow } from '../../temporal/workflows';

function priceSchema(field: string) {
  return z
    .string({ error: `${field} must be a single value` })
    .trim()
    .min(1, `${field} must not be empty`)
    .transform(Number)
    .pipe(z.number({ error: `${field} must be a number` }).min(0, `${field} must be >= 0`))
    .optional();
}

const hotelsQuerySchema = z
  .object({
    city: z
      .string({ error: 'city is required' })
      .trim()
      .toLowerCase()
      .min(1, 'city must not be empty'),
    minPrice: priceSchema('minPrice'),
    maxPrice: priceSchema('maxPrice'),
  })
  .refine(
    ({ minPrice, maxPrice }) =>
      minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice,
    { message: 'minPrice must be less than or equal to maxPrice', path: ['minPrice'] },
  );

type CacheStatus = 'BYPASS' | 'HIT' | 'MISS';

interface SearchResult {
  cacheStatus: CacheStatus;
  hotels: HotelOffer[];
  failedSuppliers: SupplierName[];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const priceFilterUnavailable = 'Price filtering is temporarily unavailable';

function isAllSuppliersDown(err: unknown): boolean {
  return (
    err instanceof WorkflowFailedError &&
    err.cause instanceof ApplicationFailure &&
    err.cause.type === 'SUPPLIERS_DOWN'
  );
}

function sendSearchResult(res: Response, result: SearchResult): void {
  res.set('X-Cache', result.cacheStatus);
  if (result.failedSuppliers.length > 0) {
    res.set('X-Partial-Results', result.failedSuppliers.join(','));
  }
  res.json(result.hotels);
}

export interface HotelsRouterDeps {
  temporalClient: Client;
  hotelCache: HotelCache;
}

export function createHotelsRouter({ temporalClient, hotelCache }: HotelsRouterDeps): Router {
  async function runWorkflow(city: string): Promise<HotelOffersResult> {
    const workflowId = `hotel-offers-${city}-${randomUUID()}`;
    try {
      return await temporalClient.workflow.execute<typeof hotelOffersWorkflow>(
        'hotelOffersWorkflow',
        {
          args: [city],
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          workflowId,
          workflowExecutionTimeout: '30 seconds',
        },
      );
    } catch (err) {
      if (isAllSuppliersDown(err)) {
        throw new HttpError(502, 'All suppliers are unavailable', { cause: err });
      }
      throw new Error(`Hotel offers workflow ${workflowId} failed`, { cause: err });
    }
  }

  async function queryCache(
    city: string,
    minPrice?: number,
    maxPrice?: number,
  ): Promise<CacheQueryResult> {
    try {
      return await hotelCache.query(city, minPrice, maxPrice);
    } catch (err) {
      throw new HttpError(503, priceFilterUnavailable, { cause: err });
    }
  }

  async function freshSearch(city: string): Promise<SearchResult> {
    const result = await runWorkflow(city);
    return {
      cacheStatus: 'BYPASS',
      hotels: result.hotels,
      failedSuppliers: result.failedSuppliers,
    };
  }

  async function filteredSearch(
    city: string,
    minPrice?: number,
    maxPrice?: number,
  ): Promise<SearchResult> {
    const cachedResult = await queryCache(city, minPrice, maxPrice);
    if (cachedResult.hit) {
      return {
        cacheStatus: 'HIT',
        hotels: cachedResult.hotels,
        failedSuppliers: cachedResult.failedSuppliers,
      };
    }

    const workflowResult = await runWorkflow(city);
    if (!workflowResult.cached) {
      throw new HttpError(503, priceFilterUnavailable);
    }

    const freshResult = await queryCache(city, minPrice, maxPrice);
    if (!freshResult.hit) {
      throw new HttpError(503, priceFilterUnavailable);
    }
    return {
      cacheStatus: 'MISS',
      hotels: freshResult.hotels,
      failedSuppliers: workflowResult.failedSuppliers,
    };
  }

  const router = Router();

  router.get('/api/hotels', async (req, res) => {
    const query = hotelsQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: z.flattenError(query.error).fieldErrors,
      });
      return;
    }

    const { city, minPrice, maxPrice } = query.data;
    const hasPriceFilter = minPrice !== undefined || maxPrice !== undefined;

    try {
      const result = hasPriceFilter
        ? await filteredSearch(city, minPrice, maxPrice)
        : await freshSearch(city);
      sendSearchResult(res, result);
    } catch (err) {
      if (!(err instanceof HttpError)) {
        throw err;
      }
      req.log.warn({ err }, 'Hotel search failed');
      res.status(err.status).json({ error: err.message });
    }
  });

  return router;
}
