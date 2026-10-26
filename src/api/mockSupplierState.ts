// Test hook: in-memory, per API process.
export type MockSupplierId = 'a' | 'b';
export type MockSupplierMode = 'up' | 'down';
export type MockSupplierState = Record<MockSupplierId, MockSupplierMode>;

export function createMockSupplierState(): MockSupplierState {
  return { a: 'up', b: 'up' };
}
