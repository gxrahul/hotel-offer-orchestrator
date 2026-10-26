import { selectBestOffers } from '../../src/domain/selectBestOffers';
import type { HotelOffer, SupplierHotel, SupplierName } from '../../src/domain/types';
import supplierAData from '../../src/mock-data/supplierA.json';
import supplierBData from '../../src/mock-data/supplierB.json';

function offer(
  name: string,
  price: number,
  supplier: SupplierName,
  commissionPct: number,
): HotelOffer {
  return { name, price, supplier, commissionPct };
}

function toOffers(hotels: SupplierHotel[], supplier: SupplierName, city: string): HotelOffer[] {
  return hotels
    .filter((hotel) => hotel.city === city)
    .map((hotel) => offer(hotel.name, hotel.price, supplier, hotel.commissionPct));
}

function mockOffersFor(city: string): HotelOffer[] {
  return [
    ...toOffers(supplierAData, 'Supplier A', city),
    ...toOffers(supplierBData, 'Supplier B', city),
  ];
}

describe('selectBestOffers', () => {
  it('picks Supplier A when it is cheaper', () => {
    const result = selectBestOffers([
      offer('Holtin', 5000, 'Supplier A', 10),
      offer('Holtin', 6000, 'Supplier B', 20),
    ]);
    expect(result).toEqual([offer('Holtin', 5000, 'Supplier A', 10)]);
  });

  it('picks Supplier B when it is cheaper', () => {
    const result = selectBestOffers([
      offer('Holtin', 6000, 'Supplier A', 20),
      offer('Holtin', 5340, 'Supplier B', 10),
    ]);
    expect(result).toEqual([offer('Holtin', 5340, 'Supplier B', 10)]);
  });

  it('picks the higher commission when prices are equal', () => {
    const result = selectBestOffers([
      offer('Taj Palace', 9000, 'Supplier A', 12),
      offer('Taj Palace', 9000, 'Supplier B', 15),
    ]);
    expect(result).toEqual([offer('Taj Palace', 9000, 'Supplier B', 15)]);
  });

  it('picks Supplier A when price and commission are equal', () => {
    const result = selectBestOffers([
      offer('Taj Palace', 9000, 'Supplier B', 12),
      offer('Taj Palace', 9000, 'Supplier A', 12),
    ]);
    expect(result).toEqual([offer('Taj Palace', 9000, 'Supplier A', 12)]);
  });

  it('treats names differing only in case and spaces as one hotel', () => {
    const result = selectBestOffers([
      offer('  radison   blu ', 6100, 'Supplier B', 18),
      offer('Radison Blu', 5900, 'Supplier A', 13),
    ]);
    expect(result).toEqual([offer('Radison Blu', 5900, 'Supplier A', 13)]);
  });

  it('returns the winning name trimmed with whitespace collapsed', () => {
    const result = selectBestOffers([
      offer('  Radison   Blu ', 5900, 'Supplier B', 13),
      offer('radison blu', 6100, 'Supplier A', 18),
    ]);
    expect(result).toEqual([offer('Radison Blu', 5900, 'Supplier B', 13)]);
  });

  it('keeps a hotel offered by only one supplier', () => {
    const result = selectBestOffers([
      offer('The Oberoi', 11000, 'Supplier A', 18),
      offer('Lemon Tree', 3500, 'Supplier B', 8),
    ]);
    expect(result).toEqual([
      offer('Lemon Tree', 3500, 'Supplier B', 8),
      offer('The Oberoi', 11000, 'Supplier A', 18),
    ]);
  });

  it('keeps the cheapest of duplicate names within one supplier', () => {
    const result = selectBestOffers([
      offer('Holtin', 6000, 'Supplier A', 10),
      offer('holtin', 5500, 'Supplier A', 10),
      offer('Holtin ', 7000, 'Supplier A', 10),
    ]);
    expect(result).toEqual([offer('holtin', 5500, 'Supplier A', 10)]);
  });

  it('sorts by price, then by normalized name for equal prices', () => {
    const result = selectBestOffers([
      offer('Zen Stay', 4000, 'Supplier A', 10),
      offer('beach House', 4000, 'Supplier B', 10),
      offer('Alpine Lodge', 4000, 'Supplier A', 10),
      offer('Budget Inn', 2000, 'Supplier B', 5),
    ]);
    expect(result.map((o) => o.name)).toEqual([
      'Budget Inn',
      'Alpine Lodge',
      'beach House',
      'Zen Stay',
    ]);
  });

  it('returns the same result when the input order changes', () => {
    const offers = [
      offer('Holtin', 6000, 'Supplier A', 10),
      offer('Holtin', 5340, 'Supplier B', 20),
      offer('Taj Palace', 9000, 'Supplier B', 12),
      offer('Taj Palace', 9000, 'Supplier A', 12),
      offer('radison ', 6100, 'Supplier B', 18),
      offer('Radison', 5900, 'Supplier A', 13),
      offer('Lemon Tree', 3500, 'Supplier B', 8),
    ];
    const expected = selectBestOffers(offers);

    expect(selectBestOffers([...offers].reverse())).toEqual(expected);
    expect(selectBestOffers([...offers.slice(3), ...offers.slice(0, 3)])).toEqual(expected);
  });

  it('returns an empty list for empty input', () => {
    expect(selectBestOffers([])).toEqual([]);
  });

  it('does not mutate the input array or its objects', () => {
    const offers = [
      offer('  Holtin ', 6000, 'Supplier A', 10),
      offer('Holtin', 5340, 'Supplier B', 20),
      offer('Lemon Tree', 3500, 'Supplier B', 8),
    ];
    const snapshot = structuredClone(offers);
    offers.forEach((o) => Object.freeze(o));
    Object.freeze(offers);

    selectBestOffers(offers);

    expect(offers).toEqual(snapshot);
  });

  describe('with mock supplier data', () => {
    it('selects the expected delhi offers in order', () => {
      expect(selectBestOffers(mockOffersFor('delhi'))).toEqual([
        { name: 'Lemon Tree', price: 3500, supplier: 'Supplier B', commissionPct: 8 },
        { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
        { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
        { name: 'Taj Palace', price: 9000, supplier: 'Supplier A', commissionPct: 15 },
        { name: 'The Oberoi', price: 11000, supplier: 'Supplier A', commissionPct: 18 },
      ]);
    });

    it('selects the expected mumbai offers in order', () => {
      expect(selectBestOffers(mockOffersFor('mumbai'))).toEqual([
        { name: 'Sea View Inn', price: 4800, supplier: 'Supplier A', commissionPct: 9 },
        { name: 'Trident', price: 7200, supplier: 'Supplier A', commissionPct: 14 },
      ]);
    });

    it('returns an empty list for a city no supplier covers', () => {
      expect(selectBestOffers(mockOffersFor('goa'))).toEqual([]);
    });
  });
});
