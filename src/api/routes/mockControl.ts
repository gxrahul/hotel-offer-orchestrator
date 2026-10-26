import { Router, type Request } from 'express';
import { z } from 'zod';
import type { HotelCache } from '../../lib/hotelCache';
import type { MockSupplierId, MockSupplierState } from '../mockSupplierState';

const stateBodySchema = z.object({
  mode: z.enum(['up', 'down'], { error: 'mode must be "up" or "down"' }),
});

function parseSupplierId(id: string): MockSupplierId | undefined {
  const normalizedId = id.toLowerCase();
  return normalizedId === 'a' || normalizedId === 'b' ? normalizedId : undefined;
}

export interface MockControlRouterDeps {
  state: MockSupplierState;
  hotelCache: HotelCache;
}

export function createMockControlRouter({ state, hotelCache }: MockControlRouterDeps): Router {
  async function clearCacheAndLog(req: Request): Promise<void> {
    const deletedKeys = await hotelCache.clearAll();
    req.log.info({ suppliers: state, deletedKeys }, 'Mock supplier state changed, cache cleared');
  }

  const router = Router();

  router.post('/mock/suppliers/reset', async (req, res) => {
    state.a = 'up';
    state.b = 'up';
    await clearCacheAndLog(req);
    res.json(state);
  });

  router.post('/mock/suppliers/:id/state', async (req, res) => {
    const id = parseSupplierId(req.params.id);
    if (id === undefined) {
      res.status(400).json({ error: `Unknown supplier id "${req.params.id}", use "a" or "b"` });
      return;
    }

    const body = stateBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'mode must be "up" or "down"' });
      return;
    }

    state[id] = body.data.mode;
    await clearCacheAndLog(req);
    res.json(state);
  });

  return router;
}
