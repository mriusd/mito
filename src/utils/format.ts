import type { AssetName, AssetSymbol, Market, Order, Position, Trade } from '../types';

export function symbolToAsset(symbol: AssetSymbol): AssetName {
  return symbol.replace('USDT', '') as AssetName;
}

export function assetToSymbol(asset: AssetName): AssetSymbol {
  return (asset + 'USDT') as AssetSymbol;
}

/**
 * Up/Down: 5m/15m windows align with Polymarket Chainlink settlement — use Chainlink spot in UI when available.
 * 1h/4h/24h use Binance spot as the displayed underlying.
 */
export function upDownMarketUsesChainlinkSpot(market: { eventSlug?: string; question?: string } | null | undefined): boolean {
  if (!market) return false;
  const combined = `${market.eventSlug || ''} ${market.question || ''}`;
  if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) return true;
  if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) return true;
  return false;
}

/**
 * Gamma / chart-WS volume in USDC (YES token row). Prefers `marketLookup` when `live.id === market.id`
 * so nested `upOrDownMarkets` refs stay in sync with `bidAskBatch` patches.
 */
export function getPolymarketVolumeUsd(market: Market, yesTokenId: string, lookup: Record<string, Market>): number | null {
  const live = yesTokenId ? lookup[yesTokenId] : undefined;
  let raw: unknown;
  if (live != null && live.id === market.id) {
    raw = live.volume !== undefined && live.volume !== null ? live.volume : market.volume;
  } else {
    raw = market.volume;
  }
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

/** Thousands of USDC, one decimal (e.g. 12.3k). */
export function formatPolymarketVolumeK(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return '—';
  return `${(usd / 1000).toFixed(1)}k`;
}

/** Sidebar orderbook line only: Vol. 12.3k$; Vol. — when unknown. */
export function formatPolymarketVolumeSidebar(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return 'Vol. —';
  return `Vol. ${(usd / 1000).toFixed(1)}k$`;
}

export function formatPrice(price: number, asset?: AssetName): string {
  const decimals = asset === 'XRP' ? 4 : 2;
  return '$' + price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatStrikePrice(price: number): string {
  if (price >= 1000) {
    const k = price / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return price % 1 === 0 ? String(price) : price.toFixed(2).replace(/\.?0+$/, '');
}

export function getMarketPriceCondition(question: string | null | undefined, tokenId?: string, marketLookup?: Record<string, Market>): string {
  let eventSlug = '';
  if (!question && tokenId && marketLookup) {
    const market = marketLookup[tokenId];
    if (market) {
      question = market.question || market.eventTitle || '';
      eventSlug = market.eventSlug || '';
    }
  }
  if (!question) return tokenId?.slice(0, 8) || '?';

  // Weekly hit: "Will Bitcoin reach $84,000 March 9-15?" or "Will Bitcoin dip to $62,000 March 9-15?"
  const hitReachMatch = question.match(/reach\s+\$?([\d,.]+)/i);
  if (hitReachMatch) return `Hit ↑${formatStrikePrice(parseFloat(hitReachMatch[1].replace(/,/g, '')))}`;

  const hitDipMatch = question.match(/dip\s+to\s+\$?([\d,.]+)/i);
  if (hitDipMatch) return `Hit ↓${formatStrikePrice(parseFloat(hitDipMatch[1].replace(/,/g, '')))}`;

  // Up or Down markets
  const combined = eventSlug ? `${question} ${eventSlug}` : question;
  const upDownMatch = combined.match(/up\s+or\s+down/i) || combined.match(/updown/i);
  if (upDownMatch) {
    const fiveMin = combined.match(/\b5[- ]?min/i) || combined.match(/updown-5m/i);
    const fifteenMin = combined.match(/\b15[- ]?min/i) || combined.match(/updown-15m/i);
    const fourHour = combined.match(/\b4[- ]?h/i) || combined.match(/updown-4h/i);
    const hourlySlug = combined.match(/up-or-down-\w+-\d+-\d{4}-(\d+)(am|pm)-et/i);
    const dailySlug = combined.match(/up-or-down-on-/i);
    if (fiveMin) return '↑↓ 5m';
    if (fifteenMin) return '↑↓ 15m';
    if (fourHour) return '↑↓ 4h';
    if (hourlySlug) return `↑↓ 1h ${hourlySlug[1]}${hourlySlug[2].toUpperCase()}`;
    if (dailySlug) {
      const dm = combined.match(/on\s+(\w+)\s+(\d+)/i);
      return dm ? `↑↓ 24h ${dm[1].slice(0, 3).toUpperCase()} ${dm[2]}` : '↑↓ 24h';
    }
    return '↑↓';
  }

  const aboveMatch = question.match(/above\s+\$?([\d,.]+)/i);
  if (aboveMatch) return `>${formatStrikePrice(parseFloat(aboveMatch[1].replace(/,/g, '')))}`;

  const betweenMatch = question.match(/between\s+\$?([\d,.]+)\s+and\s+\$?([\d,.]+)/i);
  if (betweenMatch) return `${formatStrikePrice(parseFloat(betweenMatch[1].replace(/,/g, '')))}-${formatStrikePrice(parseFloat(betweenMatch[2].replace(/,/g, '')))}`;

  const lessMatch = question.match(/(?:less than|below|under)\s+\$?([\d,.]+)/i);
  if (lessMatch) return `<${formatStrikePrice(parseFloat(lessMatch[1].replace(/,/g, '')))}`;

  const greaterMatch = question.match(/(?:greater than|more than|over)\s+\$?([\d,.]+)/i);
  if (greaterMatch) return `>${formatStrikePrice(parseFloat(greaterMatch[1].replace(/,/g, '')))}`;

  return question.slice(0, 15) + (question.length > 15 ? '…' : '');
}

export function shortenMarketName(question: string | null | undefined, tokenId?: string, marketLookup?: Record<string, Market>, eventSlug?: string): string {
  if (!question && tokenId && marketLookup) {
    const market = marketLookup[tokenId];
    if (market) question = market.question || market.eventTitle || '';
  }
  if (!question) return tokenId?.slice(0, 12) || 'Unknown';
  const combinedText = eventSlug ? `${question} ${eventSlug}` : question;

  const assetMatch = question.match(/\b(BTC|ETH|SOL|XRP|Bitcoin|Ethereum|Solana)\b/i);
  const asset = assetMatch ? assetMatch[1].toUpperCase().replace('BITCOIN', 'BTC').replace('ETHEREUM', 'ETH').replace('SOLANA', 'SOL') : '';

  const dateMatch = question.match(/(?:on|by)\s+(\w+)\s+(\d+)/i);
  const dateStr = dateMatch ? `${dateMatch[1].slice(0, 3).toUpperCase()} ${dateMatch[2]}` : '';

  // Weekly hit: "Will Bitcoin reach $84,000 March 9-15?"
  const hitDateMatch = question.match(/(\w+)\s+(\d+)-(\d+)\s*\?/i);
  const hitDateStr = hitDateMatch ? `${hitDateMatch[1].slice(0, 3).toUpperCase()} ${hitDateMatch[2]}-${hitDateMatch[3]}` : '';

  const hitReachMatch = question.match(/reach\s+\$?([\d,.]+)/i);
  if (hitReachMatch) return `${asset} Hit ↑${formatStrikePrice(parseFloat(hitReachMatch[1].replace(/,/g, '')))} ${hitDateStr}`.trim();

  const hitDipMatch = question.match(/dip\s+to\s+\$?([\d,.]+)/i);
  if (hitDipMatch) return `${asset} Hit ↓${formatStrikePrice(parseFloat(hitDipMatch[1].replace(/,/g, '')))} ${hitDateStr}`.trim();

  // Up or Down: various patterns like "go up or down", "be up or down", "up or down on", slug-based titles
  const upDownMatch = combinedText.match(/up\s+or\s+down/i) || combinedText.match(/updown/i);
  if (upDownMatch) {
    // Detect timeframe from question + slug combined text
    const fiveMinMatch = combinedText.match(/\b5[- ]?min/i) || combinedText.match(/updown-5m/i);
    const fifteenMinMatch = combinedText.match(/\b15[- ]?min/i) || combinedText.match(/updown-15m/i);
    const fourHourMatch = combinedText.match(/\b4[- ]?h/i) || combinedText.match(/updown-4h/i);
    // 1h slug: bitcoin-up-or-down-march-17-2026-3am-et (has hour+am/pm before -et)
    const hourlySlugMatch = combinedText.match(/up-or-down-\w+-\d+-\d{4}-(\d+)(am|pm)-et/i);
    const timeMatch = combinedText.match(/between\s+([\d:]+\s*[AP]M)\s+and\s+([\d:]+\s*[AP]M)/i);
    // 24h slug: bitcoin-up-or-down-on-march-18-2026
    const dailySlugMatch = combinedText.match(/up-or-down-on-/i);
    const onDateMatch = dailySlugMatch ? combinedText.match(/on\s+(\w+)\s+(\d+)/i) : null;
    const looseDateMatch = combinedText.match(/(\w+)\s+(\d{1,2}),?\s+\d{4}/i);
    let tf = '';
    let timeStr = '';
    if (fiveMinMatch) {
      tf = '5m';
    } else if (fifteenMinMatch) {
      tf = '15m';
    } else if (fourHourMatch) {
      tf = '4h';
    } else if (hourlySlugMatch) {
      tf = '1h';
      timeStr = `${hourlySlugMatch[1]}${hourlySlugMatch[2].toUpperCase()} ET`;
    } else if (timeMatch) {
      tf = '1h';
      timeStr = `${timeMatch[1]}-${timeMatch[2]}`;
    } else if (onDateMatch) {
      tf = '24h';
      timeStr = `${onDateMatch[1].slice(0, 3).toUpperCase()} ${onDateMatch[2]}`;
    } else if (looseDateMatch) {
      tf = '24h';
      timeStr = `${looseDateMatch[1].slice(0, 3).toUpperCase()} ${looseDateMatch[2]}`;
    } else if (dateStr) {
      timeStr = dateStr;
    }
    return `${asset} ↑↓ ${tf} ${timeStr}`.replace(/\s+/g, ' ').trim();
  }

  const aboveMatch = question.match(/above\s+\$?([\d,.]+)/i);
  if (aboveMatch) return `${asset} >$${formatStrikePrice(parseFloat(aboveMatch[1].replace(/,/g, '')))} ${dateStr}`.trim();

  const betweenMatch = question.match(/between\s+\$?([\d,.]+)\s+and\s+\$?([\d,.]+)/i);
  if (betweenMatch) return `${asset} $${formatStrikePrice(parseFloat(betweenMatch[1].replace(/,/g, '')))}-${formatStrikePrice(parseFloat(betweenMatch[2].replace(/,/g, '')))} ${dateStr}`.trim();

  const lessMatch = question.match(/(?:less than|below|under)\s+\$?([\d,.]+)/i);
  if (lessMatch) return `${asset} <$${formatStrikePrice(parseFloat(lessMatch[1].replace(/,/g, '')))} ${dateStr}`.trim();

  const greaterMatch = question.match(/(?:greater than|more than|over)\s+\$?([\d,.]+)/i);
  if (greaterMatch) return `${asset} >$${formatStrikePrice(parseFloat(greaterMatch[1].replace(/,/g, '')))} ${dateStr}`.trim();

  return question.slice(0, 25) + (question.length > 25 ? '...' : '');
}

/**
 * Wallet info “Latest Markets” table: for short up/down (5m / 15m / 1h / 4h), show market end time
 * (e.g. `1:30 PM`) instead of the `↑↓ 5m`-style label. Other markets use {@link shortenMarketName}.
 */
export function shortenUpDownMarketListCell(
  question: string | null | undefined,
  eventSlug: string | null | undefined,
  endDateIso: string | null | undefined,
): string {
  const combinedText = eventSlug ? `${question || ''} ${eventSlug}` : question || '';
  const upDownMatch = combinedText.match(/up\s+or\s+down/i) || combinedText.match(/updown/i);
  if (!upDownMatch) {
    return shortenMarketName(question, undefined, undefined, eventSlug || undefined);
  }

  const fiveMinMatch = combinedText.match(/\b5[- ]?min/i) || combinedText.match(/updown-5m/i);
  const fifteenMinMatch = combinedText.match(/\b15[- ]?min/i) || combinedText.match(/updown-15m/i);
  const fourHourMatch = combinedText.match(/\b4[- ]?h\b/i) || combinedText.match(/updown-4h/i);
  const oneHourMatch =
    combinedText.match(/up-or-down-\w+-\d+-\d{4}-\d+(am|pm)-et/i) ||
    combinedText.match(/between\s+[\d:]+\s*[AP]M\s+and\s+[\d:]+\s*[AP]M/i) ||
    combinedText.match(/\b1[- ]?h\b/i) ||
    combinedText.match(/updown-1h/i);

  const isDailyOnly =
    combinedText.match(/up-or-down-on-/i) &&
    !fiveMinMatch &&
    !fifteenMinMatch &&
    !fourHourMatch &&
    !oneHourMatch;

  if (isDailyOnly || (!fiveMinMatch && !fifteenMinMatch && !fourHourMatch && !oneHourMatch)) {
    return shortenMarketName(question, undefined, undefined, eventSlug || undefined);
  }

  const end = (endDateIso || '').trim();
  if (!end) {
    return shortenMarketName(question, undefined, undefined, eventSlug || undefined);
  }
  const d = new Date(end);
  if (Number.isNaN(d.getTime())) {
    return shortenMarketName(question, undefined, undefined, eventSlug || undefined);
  }

  const timeLabel = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const assetMatch = (question || '').match(/\b(BTC|ETH|SOL|XRP|Bitcoin|Ethereum|Solana)\b/i);
  const asset = assetMatch
    ? assetMatch[1].toUpperCase().replace('BITCOIN', 'BTC').replace('ETHEREUM', 'ETH').replace('SOLANA', 'SOL')
    : '';
  const tfLabel = fiveMinMatch ? '5m' : fifteenMinMatch ? '15m' : fourHourMatch ? '4h' : '1h';
  const base = `${asset ? `${asset} ` : ''}${tfLabel} ${timeLabel}`.replace(/\s+/g, ' ').trim();
  return base || `${tfLabel} ${timeLabel}`;
}

export function getTokenOutcome(tokenId: string, marketLookup: Record<string, Market>): string {
  const market = marketLookup[tokenId];
  if (!market) return '';
  const tokenIds = market.clobTokenIds || [];
  if (tokenIds[0] === tokenId) return 'YES';
  if (tokenIds[1] === tokenId) return 'NO';
  return '';
}

/** Polymarket Data API uses `asset` for the outcome token id; avoid using `market` unless it looks like a numeric CLOB id (slugs caused false matches). */
export function getTradeClobTokenId(t: Pick<Trade, 'asset_id' | 'asset' | 'token_id' | 'market'>): string {
  const a = String(t.asset_id ?? t.asset ?? t.token_id ?? '').trim();
  if (a) return a;
  const m = String(t.market ?? '').trim();
  if (/^\d{15,}$/.test(m)) return m;
  return '';
}

export function getOrderClobTokenId(o: Pick<Order, 'asset_id' | 'token_id'>): string {
  return String(o.asset_id ?? o.token_id ?? '').trim();
}

/** Canonical decimal string for CLOB outcome token id (matches on-chain WS / wallet position keys). */
export function normalizeClobTokenId(id: string | null | undefined): string {
  const s = String(id ?? '').trim();
  if (!s) return '';
  try {
    return BigInt(s).toString();
  } catch {
    return s;
  }
}

/** Polymarket position row → outcome token id (Data API may use `asset`, `asset_id`, or `token_id`). */
export function getPositionClobTokenId(p: Pick<Position, 'asset' | 'asset_id' | 'token_id'>): string {
  return String(p.asset ?? p.asset_id ?? p.token_id ?? '').trim();
}

/** True if this outcome token is one of the selected market's CLOB ids and lookup agrees on Gamma `market.id` when present. */
export function outcomeTokenBelongsToSelectedMarket(
  tokenId: string,
  selected: Market | null | undefined,
  marketLookup: Record<string, Market>,
): boolean {
  if (!tokenId || !selected?.clobTokenIds?.length) return false;
  if (!selected.clobTokenIds.includes(tokenId)) return false;
  const row = marketLookup[tokenId];
  if (row?.id && selected.id && row.id !== selected.id) return false;
  return true;
}

export function tradeMatchesSelectedMarket(
  t: Trade,
  selected: Market | null | undefined,
  marketLookup: Record<string, Market>,
): boolean {
  const tid = getTradeClobTokenId(t);
  if (!tid) return false;
  if (!outcomeTokenBelongsToSelectedMarket(tid, selected, marketLookup)) return false;
  const cond = String(t.conditionId ?? '').trim();
  if (cond && selected?.id && cond !== selected.id) return false;
  return true;
}

export function extractAssetFromMarket(market: Market): AssetName | '' {
  const question = market.question || market.groupItemTitle || '';
  if (question.includes('Bitcoin') || question.includes('BTC')) return 'BTC';
  if (question.includes('Ethereum') || question.includes('ETH')) return 'ETH';
  if (question.includes('Solana') || question.includes('SOL')) return 'SOL';
  if (question.includes('XRP')) return 'XRP';
  return '';
}

/**
 * Weekly/monthly hit markets from Gamma often put only the strike in groupItemTitle (e.g. "$84,000")
 * with no ↑/↓. Direction comes from the question ("reach $X" vs "dip to $X").
 * Shared with signals computation and Smart Money panel display.
 */
export function hitStrikeMetaForBs(m: Market): { bsPriceStr: string; isReachHit: boolean; isDipHit: boolean } | null {
  const q = (m.question || '').trim();
  const reach =
    q.match(/reach\s+\$?([\d,.]+[kK]?)/i)
    || q.match(/\bhit\s+\$?([\d,.]+[kK]?)/i);
  const dip = q.match(/dip\s+to\s+\$?([\d,.]+[kK]?)/i);
  const norm = (cap: string) => cap.replace(/,/g, '').trim();
  if (reach && !dip) {
    return { bsPriceStr: '>' + norm(reach[1]), isReachHit: true, isDipHit: false };
  }
  if (dip && !reach) {
    return { bsPriceStr: '<' + norm(dip[1]), isReachHit: false, isDipHit: true };
  }

  const priceStr = m.groupItemTitle || '';
  if (!priceStr) return null;
  const raw = priceStr.replace(/[\$,]/g, '').replace(/\s+/g, '');
  const hasUp = raw.includes('↑');
  const hasDown = raw.includes('↓');
  if (hasUp && !hasDown) {
    const num = raw.replace(/[↑↓]/g, '');
    if (num) return { bsPriceStr: '>' + num, isReachHit: true, isDipHit: false };
  }
  if (hasDown && !hasUp) {
    const num = raw.replace(/[↑↓]/g, '');
    if (num) return { bsPriceStr: '<' + num, isReachHit: false, isDipHit: true };
  }

  const cleaned = priceStr.replace(/[\$,]/g, '').replace(/(.+)↑/, '>$1').replace(/(.+)↓/, '<$1').trim();
  const bsPriceStr =
    cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-') ? cleaned : '>' + cleaned;
  const isDipHit = cleaned.startsWith('<');
  return { bsPriceStr, isReachHit: !isDipHit, isDipHit };
}

export function hitDisplayStrike(groupTitle: string, bsPriceStr: string, isReachHit: boolean): string {
  if (groupTitle) return groupTitle;
  const n = bsPriceStr.replace(/^[<>]/, '');
  return isReachHit ? `${n}↑` : `${n}↓`;
}

function inferSignalTableType(m: Market): 'above' | 'price' | 'hit' {
  if (hitStrikeMetaForBs(m) != null) return 'hit';
  const q = (m.question || '').trim();
  if (/\bbetween\b.+\band\b/i.test(q)) return 'price';
  return 'above';
}

/** Raw strike string passed into `formatPriceShort` in SignalsTable — same rules as useSignalsAndArbs displayPrice. */
export function getSignalTablePriceStr(m: Market, marketLookup?: Record<string, Market>): string {
  const tableType = inferSignalTableType(m);
  const priceStr = m.groupItemTitle || '';
  if (tableType === 'hit') {
    const hitMeta = hitStrikeMetaForBs(m);
    if (!hitMeta) return priceStr || (m.question ? m.question.slice(0, 24) : '');
    return hitDisplayStrike(priceStr, hitMeta.bsPriceStr, hitMeta.isReachHit);
  }
  if (!priceStr) {
    const tid = m.clobTokenIds?.[0];
    return getMarketPriceCondition(m.question, tid, marketLookup);
  }
  return tableType === 'above' && !priceStr.includes('>') && !priceStr.includes('<')
    ? '>' + priceStr
    : priceStr;
}

export function formatPriceShort(priceStr: string): string {
  const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '').trim();
  if (cleaned.startsWith('↑') || cleaned.startsWith('↓') || cleaned.startsWith('<') || cleaned.startsWith('>')) {
    const sym = cleaned[0];
    const num = parseFloat(cleaned.substring(1));
    if (isNaN(num)) return priceStr;
    if (num >= 1000) return sym + (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k';
    return sym + num;
  }
  if (cleaned.includes('-')) {
    const parts = cleaned.split('-');
    const num1 = parseFloat(parts[0]);
    const num2 = parseFloat(parts[1]);
    if (num1 >= 1000 && num2 >= 1000) {
      const k1 = (num1 / 1000).toFixed(num1 % 1000 === 0 ? 0 : 1);
      const k2 = (num2 / 1000).toFixed(num2 % 1000 === 0 ? 0 : 1);
      return k1 + '-' + k2 + 'k';
    }
    return num1 + '-' + num2;
  }
  const num = parseFloat(cleaned);
  if (num >= 1000) return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k';
  return cleaned;
}

export const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

export function formatDateShort(endDate: string): string {
  if (!endDate) return '';
  const d = new Date(endDate);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export function timeUntil(endDate: string): string {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
  return `${hours}h${minutes}m`;
}
