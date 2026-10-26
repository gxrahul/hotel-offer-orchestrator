import { Router } from 'express';
import { getHealthReport, type HealthChecks } from '../health';

export function createHealthRouter(checks: HealthChecks): Router {
  const router = Router();

  // For Docker
  router.get('/livez', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // supplier health check
  router.get('/health', async (_req, res) => {
    const report = await getHealthReport(checks);
    res.status(report.status === 'down' ? 503 : 200).json(report);
  });

  return router;
}
