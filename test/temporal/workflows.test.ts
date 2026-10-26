import { ApplicationFailure, WorkflowFailedError } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import type { HotelOffer, SupplierName } from '../../src/domain/types';
import type { Activities } from '../../src/temporal/activities';
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

const fetchFromBothSuppliers: Activities['fetchSupplierHotels'] = (supplier) =>
  Promise.resolve(offersBySupplier[supplier]);

const saveSucceeds: Activities['saveHotelOffers'] = () => Promise.resolve();

describe('hotelOffersWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('WARN') });
    env = await TestWorkflowEnvironment.createLocal();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function runWorkflow(activities: Activities) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../../src/temporal/workflows'),
      activities,
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
    const result = await runWorkflow({
      fetchSupplierHotels: fetchFromBothSuppliers,
      saveHotelOffers: saveSucceeds,
    });

    expect(result).toEqual({
      hotels: [
        { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
        { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
        { name: 'The Oberoi', price: 11000, supplier: 'Supplier A', commissionPct: 18 },
      ],
      failedSuppliers: [],
      cached: true,
    });
  });

  it('continues with Supplier A when Supplier B fails', async () => {
    const result = await runWorkflow({
      fetchSupplierHotels: (supplier) =>
        supplier === 'Supplier B'
          ? Promise.reject(new Error('Supplier B is down'))
          : Promise.resolve(offersBySupplier[supplier]),
      saveHotelOffers: saveSucceeds,
    });

    expect(result).toEqual({
      hotels: [
        { name: 'Holtin', price: 6000, supplier: 'Supplier A', commissionPct: 10 },
        { name: 'The Oberoi', price: 11000, supplier: 'Supplier A', commissionPct: 18 },
      ],
      failedSuppliers: ['Supplier B'],
      cached: true,
    });
  });

  it('fails with SUPPLIERS_DOWN when both suppliers fail', async () => {
    const saveHotelOffers = jest.fn(saveSucceeds);
    let err: unknown;
    try {
      await runWorkflow({
        fetchSupplierHotels: () =>
          Promise.reject(ApplicationFailure.nonRetryable('down', 'SUPPLIER_CLIENT_ERROR')),
        saveHotelOffers,
      });
    } catch (caught) {
      err = caught;
    }

    expect(err).toBeInstanceOf(WorkflowFailedError);
    const cause = (err as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);
    expect((cause as ApplicationFailure).type).toBe('SUPPLIERS_DOWN');
    expect(saveHotelOffers).not.toHaveBeenCalled();
  });

  it('saves the selected list and failed suppliers', async () => {
    const saveHotelOffers = jest.fn(saveSucceeds);

    await runWorkflow({
      fetchSupplierHotels: (supplier) =>
        supplier === 'Supplier A'
          ? Promise.reject(ApplicationFailure.nonRetryable('down', 'SUPPLIER_CLIENT_ERROR'))
          : Promise.resolve(offersBySupplier[supplier]),
      saveHotelOffers,
    });

    expect(saveHotelOffers).toHaveBeenCalledTimes(1);
    expect(saveHotelOffers).toHaveBeenCalledWith(
      'delhi',
      [
        { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
        { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      ],
      ['Supplier A'],
    );
  });

  it('returns the hotels with cached: false when saving fails', async () => {
    const saveHotelOffers = jest.fn(() => Promise.reject(new Error('Redis is down')));

    const result = await runWorkflow({
      fetchSupplierHotels: fetchFromBothSuppliers,
      saveHotelOffers,
    });

    expect(saveHotelOffers).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      hotels: [
        { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
        { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
        { name: 'The Oberoi', price: 11000, supplier: 'Supplier A', commissionPct: 18 },
      ],
      failedSuppliers: [],
      cached: false,
    });
  });
});
