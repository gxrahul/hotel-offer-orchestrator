import { Router, type RequestHandler } from 'express';
import type { SupplierHotel } from '../../domain/types';
import supplierA from '../../mock-data/supplierA.json';
import supplierB from '../../mock-data/supplierB.json';

function hotelsHandler(hotels: readonly SupplierHotel[]): RequestHandler {
  return (req, res) => {
    const city = typeof req.query.city === 'string' ? req.query.city.toLowerCase() : undefined;
    res.json(city ? hotels.filter((h) => h.city.toLowerCase() === city) : hotels);
  };
}

export const mockSuppliersRouter = Router();
mockSuppliersRouter.get('/supplierA/hotels', hotelsHandler(supplierA));
mockSuppliersRouter.get('/supplierB/hotels', hotelsHandler(supplierB));
