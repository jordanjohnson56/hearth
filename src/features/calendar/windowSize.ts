// The storage window in months, shared by the server's pollWindow
// (window.ts, on Temporal) and the client's loadedMonths (monthGrid.ts, on
// Intl): polyfill-free, so both may import it.

export const MONTHS_BACK = 3;
export const MONTHS_AHEAD = 12;
