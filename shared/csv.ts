import type { Listing } from '../src/types';
export function amazonCsv(sku: string, listing: Listing, price: number): string {
    const rows = [
      ['sku', 'title', 'bullet_point_1', 'bullet_point_2', 'bullet_point_3', 'bullet_point_4', 'bullet_point_5', 'description', 'price', 'currency', 'marketplace', 'status'],
      [sku, listing.title, ...Array.from({ length: 5 }, (_, i) => listing.bullets[i] ?? ''), listing.description, price.toFixed(2), 'USD', 'Amazon US', 'Mock export'],
    ];
    const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
    return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
