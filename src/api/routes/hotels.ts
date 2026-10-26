import { randomUUID } from 'node:crypto';
import { ApplicationFailure, WorkflowFailedError, type Client } from '@temporalio/client';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../lib/config';
import type { hotelOffersWorkflow } from '../../temporal/workflows';

const hotelsQuerySchema = z.object({
  city: z
    .string({ error: 'city is required' })
    .trim()
    .toLowerCase()
    .min(1, 'city must not be empty'),
});

function isAllSuppliersDown(err: unknown): boolean {
  return (
    err instanceof WorkflowFailedError &&
    err.cause instanceof ApplicationFailure &&
    err.cause.type === 'SUPPLIERS_DOWN'
  );
}

export function createHotelsRouter(temporalClient: Client): Router {
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

    const { city } = query.data;
    const workflowId = `hotel-offers-${city}-${randomUUID()}`;

    try {
      const result = await temporalClient.workflow.execute<typeof hotelOffersWorkflow>(
        'hotelOffersWorkflow',
        {
          args: [city],
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          workflowId,
          workflowExecutionTimeout: '30 seconds',
        },
      );

      if (result.failedSuppliers.length > 0) {
        res.set('X-Partial-Results', result.failedSuppliers.join(','));
      }
      res.json(result.hotels);
    } catch (err) {
      if (isAllSuppliersDown(err)) {
        res.status(502).json({ error: 'All suppliers are unavailable' });
        return;
      }
      throw new Error(`Hotel offers workflow ${workflowId} failed`, { cause: err });
    }
  });

  return router;
}
