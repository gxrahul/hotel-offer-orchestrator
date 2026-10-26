import { loadConfig } from '../src/lib/config';

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      PORT: 3000,
      REDIS_URL: 'redis://localhost:6379',
      TEMPORAL_ADDRESS: 'localhost:7233',
      TEMPORAL_NAMESPACE: 'default',
      TEMPORAL_TASK_QUEUE: 'hotel-offers',
      SUPPLIER_A_URL: 'http://localhost:3000/supplierA/hotels',
      SUPPLIER_B_URL: 'http://localhost:3000/supplierB/hotels',
      CACHE_TTL_SECONDS: 300,
      PARTIAL_CACHE_TTL_SECONDS: 30,
      ENABLE_MOCK_SUPPLIERS: false,
    });
  });

  it('parses ENABLE_MOCK_SUPPLIERS as a boolean', () => {
    expect(loadConfig({ ENABLE_MOCK_SUPPLIERS: 'true' }).ENABLE_MOCK_SUPPLIERS).toBe(true);
    expect(loadConfig({ ENABLE_MOCK_SUPPLIERS: 'false' }).ENABLE_MOCK_SUPPLIERS).toBe(false);
    expect(() => loadConfig({ ENABLE_MOCK_SUPPLIERS: 'maybe' })).toThrow(/ENABLE_MOCK_SUPPLIERS/);
  });

  it('coerces numeric values', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ PORT: 'abc', REDIS_URL: 'http://x' })).toThrow(
      /Invalid environment configuration[\s\S]*PORT[\s\S]*REDIS_URL/,
    );
  });
});
