export type SupplierName = 'Supplier A' | 'Supplier B';

/** A hotel as returned by a supplier API. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** The best offer for a hotel after comparing suppliers. */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: SupplierName;
  commissionPct: number;
}
