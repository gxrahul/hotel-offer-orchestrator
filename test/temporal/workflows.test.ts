import { ApplicationFailure, WorkflowFailedError } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import type { HotelOffer, SupplierName } from '../../src/domain/types';
import type * as activities from '../../src/temporal/activities';
import type { hotelOffersWorkflow } from '../../src/temporal/workflows';

jest.setTimeout(120_000);

const taskQueue = 'hotel-offers-test';

const offersBySupplier: Record<SupplierName, HotelOffer[]> = {
  'Supplier A': [
    { name: 'Holtin', price: 6000, supplier: 'Supplier A', commissionPct: 10 },
    { name: 'The Oberoi', price: 11000, supplier: 'Supplier A', commissionPct: 18 },
  ],
  'Supplier B': [
    { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
    { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
  ],
};

describe('hotelOffersWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('WARN') });
    env = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function runWorkflow(fetchSupplierHotels: typeof activities.fetchSupplierHotels) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../../src/temporal/workflows'),
      activities: { fetchSupplierHotels },
    });
    return worker.runUntil(
      env.client.workflow.execute<typeof hotelOffersWorkflow>('hotelOffersWorkflow', {
        args: ['delhi'],
        taskQueue,
        workflowId: `test-${Date.now()}-${Math.random()}`,
      }),
    );
  }

  it('merges both suppliers when both succeed', async () => {
    const result = await runWorkflow((supplier) => Promise.resolve(offersBySupplier[supplier]));

    expect(result).toEqual({
      hotels: [
        { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
        { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
        { name: 'The Oberoi', price: 11000, supplier: 'Supplier A', commissionPct: 18 },
      ],
      failedSuppliers: [],
    });
  });

  it('continues with Supplier A when Supplier B fails', async () => {
    const result = await runWorkflow((supplier) =>
      supplier === 'Supplier B'
        ? Promise.reject(new Error('Supplier B is down'))
        : Promise.resolve(offersBySupplier[supplier]),
    );

    expect(result).toEqual({
      hotels: [
        { name: 'Holtin', price: 6000, supplier: 'Supplier A', commissionPct: 10 },
        { name: 'The Oberoi', price: 11000, supplier: 'Supplier A', commissionPct: 18 },
      ],
      failedSuppliers: ['Supplier B'],
    });
  });

  it('fails with SUPPLIERS_DOWN when both suppliers fail', async () => {
    let err: unknown;
    try {
      await runWorkflow(() =>
        Promise.reject(ApplicationFailure.nonRetryable('down', 'SUPPLIER_CLIENT_ERROR')),
      );
    } catch (caught) {
      err = caught;
    }

    expect(err).toBeInstanceOf(WorkflowFailedError);
    const cause = (err as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);
    expect((cause as ApplicationFailure).type).toBe('SUPPLIERS_DOWN');
  });
});
