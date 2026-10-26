import type { HotelOffer } from './types';

function collapseWhitespace(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function normalizeName(name: string): string {
  return collapseWhitespace(name).toLowerCase();
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isBetterOffer(candidate: HotelOffer, current: HotelOffer): boolean {
  if (candidate.price !== current.price) {
    return candidate.price < current.price;
  }
  if (candidate.commissionPct !== current.commissionPct) {
    return candidate.commissionPct > current.commissionPct;
  }
  if (candidate.supplier !== current.supplier) {
    return candidate.supplier < current.supplier;
  }
  return collapseWhitespace(candidate.name) < collapseWhitespace(current.name);
}

export function selectBestOffers(offers: readonly HotelOffer[]): HotelOffer[] {
  const bestByName = new Map<string, HotelOffer>();

  for (const offer of offers) {
    const key = normalizeName(offer.name);
    const current = bestByName.get(key);
    if (current === undefined || isBetterOffer(offer, current)) {
      bestByName.set(key, offer);
    }
  }

  return Array.from(bestByName.values())
    .map((offer) => ({ ...offer, name: collapseWhitespace(offer.name) }))
    .sort(
      (a, b) => a.price - b.price || compareStrings(normalizeName(a.name), normalizeName(b.name)),
    );
}
