import { Router, type RequestHandler } from 'express';
import type { SupplierHotel } from '../../domain/types';
import supplierA from '../../mock-data/supplierA.json';
import supplierB from '../../mock-data/supplierB.json';
import type { MockSupplierId, MockSupplierState } from '../mockSupplierState';

function hotelsHandler(
  state: MockSupplierState,
  id: MockSupplierId,
  hotels: readonly SupplierHotel[],
): RequestHandler {
  return (req, res) => {
    if (state[id] === 'down') {
      res.status(503).json({ error: 'Supplier unavailable' });
      return;
    }
    const city = typeof req.query.city === 'string' ? req.query.city.toLowerCase() : undefined;
    res.json(city ? hotels.filter((h) => h.city.toLowerCase() === city) : hotels);
  };
}

export function createMockSuppliersRouter(state: MockSupplierState): Router {
  const router = Router();
  router.get('/supplierA/hotels', hotelsHandler(state, 'a', supplierA));
  router.get('/supplierB/hotels', hotelsHandler(state, 'b', supplierB));
  return router;
}
