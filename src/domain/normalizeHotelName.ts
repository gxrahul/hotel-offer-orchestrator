export function collapseWhitespace(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function normalizeHotelName(name: string): string {
  return collapseWhitespace(name).toLowerCase();
}
