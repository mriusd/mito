/** User-facing polymarket.com links — always attach referral. */
export function polymarketSiteUrl(path: string): string {
  const base = path.startsWith('http') ? path : `https://polymarket.com/${path.replace(/^\//, '')}`;
  const url = new URL(base);
  url.searchParams.set('r', 'mito');
  return url.toString();
}
