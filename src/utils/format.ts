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

/** Bucket key for `upOrDownMarkets[asset][tf]` derived from Gamma slug/question (must match Sidebar `isUpDownMarket`). */
export function upDownTimeframeKeyFromMarket(
  market: { eventSlug?: string; question?: string; groupItemTitle?: string },
): '5m' | '15m' | '1h' | '4h' | '24h' | null {
  const combined =
    `${market.eventSlug || ''} ${market.question || ''} ${market.groupItemTitle || ''}`
      .replace(/\s+/g, ' ')
      .trim();
  if (!/up\s+or\s+down|updown|up-or-down/i.test(combined)) return null;
  if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) return '5m';
  if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) return '15m';
  if (combined.match(/updown-4h/i) || combined.match(/\b4[- ]?h/i)) return '4h';
  if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) return '24h';
  return '1h';
}

/** All TF-bucket rows with end strictly after `nowMs`; open before closed, then by end ascending. Deduped by market id. */
export function listFutureUpDownMarketsInTfBucket(marketsForTf: Market[] | undefined, nowMs: number = Date.now()): Market[] {
  if (!marketsForTf?.length) return [];
  const futures = marketsForTf.filter((m) => {
    if (!m.endDate) return false;
    const t = new Date(m.endDate).getTime();
    return Number.isFinite(t) && t > nowMs;
  });
  if (futures.length === 0) return [];
  futures.sort((a, b) => {
    const ca = a.closed ? 1 : 0;
    const cb = b.closed ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime();
  });
  const seen = new Set<string>();
  const out: Market[] = [];
  for (const m of futures) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** TF-bucket rows with end ≤ `nowMs` (past windows). Deduped by market id; end time ascending (oldest first). */
export function listPastUpDownMarketsInTfBucket(marketsForTf: Market[] | undefined, nowMs: number = Date.now()): Market[] {
  if (!marketsForTf?.length) return [];
  const past = marketsForTf.filter((m) => {
    if (!m.endDate) return false;
    const t = new Date(m.endDate).getTime();
    return Number.isFinite(t) && t <= nowMs;
  });
  if (past.length === 0) return [];
  past.sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime());
  const seen = new Set<string>();
  const out: Market[] = [];
  for (const m of past) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Soonest-ending row in TF bucket with endDate still in the future; prefers Gamma `closed === false`. */
export function pickLiveUpDownMarketInTfBucket(marketsForTf: Market[] | undefined, nowMs: number = Date.now()): Market | null {
  const list = listFutureUpDownMarketsInTfBucket(marketsForTf, nowMs);
  return list.length ? list[0]! : null;
}

/** Second soonest-ending future row in TF bucket (upcoming window after current live). */
export function pickNextUpDownMarketInTfBucket(marketsForTf: Market[] | undefined, nowMs: number = Date.now()): Market | null {
  const list = listFutureUpDownMarketsInTfBucket(marketsForTf, nowMs);
  return list.length > 1 ? list[1]! : null;
}

/**
 * Up/Down target from Gamma `priceToBeat`: same order as UpDownMarketsPanel (row → lookup).
 * Also reads `upOrDownMarkets` bucket by id when the selected snapshot lacks `priceToBeat` but the store row was refreshed (e.g. after auto-switch at expiry).
 */
export function resolveUpDownStrikeSync(
  m: Market | null | undefined,
  lookup: Record<string, Market>,
  buckets: Record<string, Record<string, Market[]>>,
): number | undefined {
  if (!m?.clobTokenIds?.length) return undefined;
  const tid = String(m.clobTokenIds[0]).trim();
  const fromLookup = tid ? lookup[tid]?.priceToBeat : undefined;

  const asset = extractAssetFromMarket(m);
  const tf = upDownTimeframeKeyFromMarket(m);
  let fromBucket: number | undefined;
  if (asset && tf) {
    const row = (buckets[asset]?.[tf] ?? []).find((x) => x.id === m.id);
    const pb = row?.priceToBeat;
    if (pb != null && Number.isFinite(pb)) fromBucket = pb;
  }

  const p =
    m.priceToBeat ??
    (fromLookup != null && Number.isFinite(fromLookup) ? fromLookup : undefined) ??
    fromBucket;
  return p != null && Number.isFinite(p) ? p : undefined;
}

/** Parsed from Gamma `outcomePrices` when a binary market is resolved (winning side is 1, loser 0). */
export function resolvedBinaryOutcomeLabel(
  market: Pick<Market, 'question' | 'eventSlug' | 'outcomePrices' | 'closed'> | null | undefined,
  isUpDownMarket: boolean,
): string | null {
  if (!market) return null;
  const raw = market.outcomePrices as unknown;
  let yesPrice: number | null = null;
  let noPrice: number | null = null;
  if (Array.isArray(raw) && raw.length >= 2) {
    yesPrice = Number(raw[0]);
    noPrice = Number(raw[1]);
  } else if (typeof raw === 'string' && raw.trim()) {
    const cleaned = raw.replace(/^\[/, '').replace(/\]$/, '');
    const parts = cleaned.split(',').map((s) => Number(String(s).trim()));
    if (parts.length >= 2) {
      yesPrice = parts[0];
      noPrice = parts[1];
    }
  }
  if (yesPrice == null || noPrice == null || !Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) return null;
  const posLabel = isUpDownMarket ? 'UP' : 'YES';
  const negLabel = isUpDownMarket ? 'DOWN' : 'NO';
  if (yesPrice > noPrice) return posLabel;
  if (noPrice > yesPrice) return negLabel;
  return null;
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

/** Σ wallet_market_positions.volume for market (from `/ws/chart` only; no Gamma fallback). */
export function getWmpVolumeSumUsd(_market: Market, yesTokenId: string, lookup: Record<string, Market>): number | null {
  const live = yesTokenId ? lookup[yesTokenId] : undefined;
  const v = live?.wmpVolumeSum;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  return null;
}

/** Thousands of USDC, one decimal (e.g. 12.3k). */
export function formatPolymarketVolumeK(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return '—';
  return `${(usd / 1000).toFixed(1)}k`;
}

/** Thousands of USDC, integer k (e.g. 12k) — narrow sidebar pills. */
export function formatPolymarketVolumeKInteger(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return '—';
  return `${Math.round(usd / 1000)}k`;
}

/** Sidebar orderbook line only: Vol. 12.3k$; Vol. — when unknown. */
export function formatPolymarketVolumeSidebar(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return 'Vol. —';
  return `Vol. ${(usd / 1000).toFixed(1)}k$`;
}

export function formatPrice(price: number, asset?: AssetName): string {
  const decimals = asset === 'XRP' ? 4 : asset === 'NG' ? 3 : 2;
  return '$' + price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function trimKFractional(s: string): string {
  return s.replace(/\.?0+$/, '');
}

/** Compact "k" mantissa for `price / 1000` (ETH: 2 fractional digits). */
function thousandsKPart(price: number, asset?: AssetName): string {
  const k = price / 1000;
  if (k % 1 === 0) return String(k);
  if (asset === 'ETH') return trimKFractional(k.toFixed(2));
  return k.toFixed(1).replace(/\.0$/, '');
}

/** e.g. 2350 → "2.35k" for ETH, "2.4k" style (one decimal) for others. */
export function formatThousandsAsK(price: number, asset?: AssetName): string {
  if (!Number.isFinite(price) || price < 1000) return String(price);
  return thousandsKPart(price, asset) + 'k';
}

/**
 * Parse strike token from Gamma/question text: "80000", "80,000", "80k" → number.
 * Gamma often uses "$80k"; naive [\d,.]+ capture stops before "k" — include k in capture and multiply here.
 */
export function parseStrikeTokenToNumber(raw: string): number {
  // RWA hit/above titles often look like "↑ $130" / "$83".
  const s = raw.replace(/[↑↓$,\s]/g, '').trim();
  if (!s) return NaN;
  const multK = /[kK]$/.test(s);
  const core = multK ? s.slice(0, -1) : s;
  const n = parseFloat(core);
  if (!Number.isFinite(n)) return NaN;
  return multK ? n * 1000 : n;
}

/** Numeric strike from Hit row title (`↑ $130`, `↓62,500`, …). */
export function parseHitStrikeNumber(title: string): number {
  const n = parseStrikeTokenToNumber(title || '');
  return Number.isFinite(n) ? n : 0;
}

export function formatStrikePrice(price: number, asset?: AssetName): string {
  if (price >= 1000) {
    return formatThousandsAsK(price, asset);
  }
  return price % 1 === 0 ? String(price) : price.toFixed(2).replace(/\.?0+$/, '');
}

const WEATHER_CITY_SLUG_LABELS: Record<string, string> = {
  nyc: 'NYC',
  london: 'London',
  'hong-kong': 'Hong Kong',
  chicago: 'Chicago',
  miami: 'Miami',
  seoul: 'Seoul',
  tokyo: 'Tokyo',
  paris: 'Paris',
  dallas: 'Dallas',
  atlanta: 'Atlanta',
};

function weatherCityLabelFromSlug(slug: string): string {
  const key = slug.toLowerCase();
  if (WEATHER_CITY_SLUG_LABELS[key]) return WEATHER_CITY_SLUG_LABELS[key];
  return slug
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/** e.g. "London ↑31°C" / "London ↓22°C" from Gamma weather question or slug + bucket title. */
export function formatWeatherMarketLabel(
  question: string | null | undefined,
  eventSlug?: string | null,
  groupItemTitle?: string | null,
): string | null {
  const q = (question || '').trim();
  const qMatch = q.match(/Will the (highest|lowest) temperature in (.+?) be (?:between )?(.+?) on /i);
  if (qMatch) {
    const arrow = qMatch[1].toLowerCase() === 'highest' ? '↑' : '↓';
    return `${qMatch[2].trim()} ${arrow}${qMatch[3].trim()}`;
  }

  const slug = (eventSlug || '').trim();
  const slugMatch = slug.match(/(highest|lowest)-temperature-in-([a-z-]+)-on-/i);
  const temp = (groupItemTitle || '').trim();
  if (slugMatch && temp) {
    const arrow = slugMatch[1].toLowerCase() === 'highest' ? '↑' : '↓';
    return `${weatherCityLabelFromSlug(slugMatch[2])} ${arrow}${temp}`;
  }

  return null;
}

export function getMarketPriceCondition(question: string | null | undefined, tokenId?: string, marketLookup?: Record<string, Market>): string {
  let eventSlug = '';
  let groupItemTitle = '';
  if (tokenId && marketLookup) {
    const market = lookupMarketByTokenId(tokenId, marketLookup);
    if (market) {
      if (!question) question = market.question || market.eventTitle || '';
      eventSlug = market.eventSlug || '';
      groupItemTitle = market.groupItemTitle || '';
    }
  }
  if (!question) return tokenId?.slice(0, 8) || '?';

  const weatherLabel = formatWeatherMarketLabel(question, eventSlug, groupItemTitle);
  if (weatherLabel) return weatherLabel;

  const strikeFmtAsset: AssetName | undefined = assetTickerFromQuestion(question) === 'ETH' ? 'ETH' : undefined;

  // Weekly hit: "Will Bitcoin reach $84,000 March 9-15?" or "Will Bitcoin dip to $62,000 March 9-15?"
  const hitReachMatch = question.match(/reach\s+\$?([\d,.]+[kK]?)/i);
  if (hitReachMatch) return `Hit ↑${formatStrikePrice(parseStrikeTokenToNumber(hitReachMatch[1]), strikeFmtAsset)}`;

  const hitDipMatch = question.match(/dip\s+to\s+\$?([\d,.]+[kK]?)/i);
  if (hitDipMatch) return `Hit ↓${formatStrikePrice(parseStrikeTokenToNumber(hitDipMatch[1]), strikeFmtAsset)}`;

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

  const aboveMatch = question.match(/above\s+\$?([\d,.]+[kK]?)/i);
  if (aboveMatch) return `>${formatStrikePrice(parseStrikeTokenToNumber(aboveMatch[1]), strikeFmtAsset)}`;

  const betweenMatch = question.match(/between\s+\$?([\d,.]+[kK]?)\s+and\s+\$?([\d,.]+[kK]?)/i);
  if (betweenMatch) return `${formatStrikePrice(parseStrikeTokenToNumber(betweenMatch[1]), strikeFmtAsset)}-${formatStrikePrice(parseStrikeTokenToNumber(betweenMatch[2]), strikeFmtAsset)}`;

  const lessMatch = question.match(/(?:less than|below|under)\s+\$?([\d,.]+[kK]?)/i);
  if (lessMatch) return `<${formatStrikePrice(parseStrikeTokenToNumber(lessMatch[1]), strikeFmtAsset)}`;

  const greaterMatch = question.match(/(?:greater than|more than|over)\s+\$?([\d,.]+[kK]?)/i);
  if (greaterMatch) return `>${formatStrikePrice(parseStrikeTokenToNumber(greaterMatch[1]), strikeFmtAsset)}`;

  return question.slice(0, 15) + (question.length > 15 ? '…' : '');
}

export function shortenMarketName(
  question: string | null | undefined,
  tokenId?: string,
  marketLookup?: Record<string, Market>,
  eventSlug?: string,
  groupItemTitle?: string,
): string {
  if (!question && tokenId && marketLookup) {
    const market = marketLookup[tokenId];
    if (market) {
      question = market.question || market.eventTitle || '';
      eventSlug = eventSlug || market.eventSlug;
      groupItemTitle = groupItemTitle || market.groupItemTitle;
    }
  }
  if (!question) return tokenId?.slice(0, 12) || 'Unknown';

  const weatherLabel = formatWeatherMarketLabel(question, eventSlug, groupItemTitle);
  if (weatherLabel) return weatherLabel;

  const combinedText = eventSlug ? `${question} ${eventSlug}` : question;

  const assetMatch = question.match(/\b(BTC|ETH|SOL|XRP|Bitcoin|Ethereum|Solana)\b/i);
  const asset = assetMatch ? assetMatch[1].toUpperCase().replace('BITCOIN', 'BTC').replace('ETHEREUM', 'ETH').replace('SOLANA', 'SOL') : '';
  const strikeFmtAssetShort: AssetName | undefined = asset === 'ETH' ? 'ETH' : undefined;

  const dateMatch = question.match(/(?:on|by)\s+(\w+)\s+(\d+)/i);
  const dateStr = dateMatch ? `${dateMatch[1].slice(0, 3).toUpperCase()} ${dateMatch[2]}` : '';

  // Weekly hit: "Will Bitcoin reach $84,000 March 9-15?"
  const hitDateMatch = question.match(/(\w+)\s+(\d+)-(\d+)\s*\?/i);
  const hitDateStr = hitDateMatch ? `${hitDateMatch[1].slice(0, 3).toUpperCase()} ${hitDateMatch[2]}-${hitDateMatch[3]}` : '';

  const hitReachMatch = question.match(/reach\s+\$?([\d,.]+[kK]?)/i);
  if (hitReachMatch) return `${asset} Hit ↑${formatStrikePrice(parseStrikeTokenToNumber(hitReachMatch[1]), strikeFmtAssetShort)} ${hitDateStr}`.trim();

  const hitDipMatch = question.match(/dip\s+to\s+\$?([\d,.]+[kK]?)/i);
  if (hitDipMatch) return `${asset} Hit ↓${formatStrikePrice(parseStrikeTokenToNumber(hitDipMatch[1]), strikeFmtAssetShort)} ${hitDateStr}`.trim();

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

  const aboveMatch = question.match(/above\s+\$?([\d,.]+[kK]?)/i);
  if (aboveMatch) return `${asset} >$${formatStrikePrice(parseStrikeTokenToNumber(aboveMatch[1]), strikeFmtAssetShort)} ${dateStr}`.trim();

  const betweenMatch = question.match(/between\s+\$?([\d,.]+[kK]?)\s+and\s+\$?([\d,.]+[kK]?)/i);
  if (betweenMatch) return `${asset} $${formatStrikePrice(parseStrikeTokenToNumber(betweenMatch[1]), strikeFmtAssetShort)}-${formatStrikePrice(parseStrikeTokenToNumber(betweenMatch[2]), strikeFmtAssetShort)} ${dateStr}`.trim();

  const lessMatch = question.match(/(?:less than|below|under)\s+\$?([\d,.]+[kK]?)/i);
  if (lessMatch) return `${asset} <$${formatStrikePrice(parseStrikeTokenToNumber(lessMatch[1]), strikeFmtAssetShort)} ${dateStr}`.trim();

  const greaterMatch = question.match(/(?:greater than|more than|over)\s+\$?([\d,.]+[kK]?)/i);
  if (greaterMatch) return `${asset} >$${formatStrikePrice(parseStrikeTokenToNumber(greaterMatch[1]), strikeFmtAssetShort)} ${dateStr}`.trim();

  return question.slice(0, 25) + (question.length > 25 ? '...' : '');
}

/** BTC / ETH / SOL / XRP from question wording (same rules as {@link shortenMarketName}). */
export function assetTickerFromQuestion(question: string | null | undefined): string {
  const assetMatch = (question || '').match(/\b(BTC|ETH|SOL|XRP|Bitcoin|Ethereum|Solana)\b/i);
  if (!assetMatch) return '';
  return assetMatch[1].toUpperCase().replace('BITCOIN', 'BTC').replace('ETHEREUM', 'ETH').replace('SOLANA', 'SOL');
}

/**
 * Wallet info “Latest Markets”: same label as {@link shortenMarketName} (incl. `↑↓` for up/down).
 * When `endDateIso` is valid, appends local window `start - end` (from timeframe: 5m / 15m / 1h / 4h / 24h daily).
 */
export function shortenUpDownMarketListCell(
  question: string | null | undefined,
  eventSlug: string | null | undefined,
  endDateIso: string | null | undefined,
): string {
  const base = shortenMarketName(question, undefined, undefined, eventSlug || undefined);
  const combinedText = eventSlug ? `${question || ''} ${eventSlug}` : question || '';
  const upDownMatch = combinedText.match(/up\s+or\s+down/i) || combinedText.match(/updown/i);
  if (!upDownMatch) return base;

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

  let windowMs = 0;
  if (fiveMinMatch) windowMs = 5 * 60 * 1000;
  else if (fifteenMinMatch) windowMs = 15 * 60 * 1000;
  else if (fourHourMatch) windowMs = 4 * 60 * 60 * 1000;
  else if (oneHourMatch) windowMs = 60 * 60 * 1000;
  else if (isDailyOnly) windowMs = 24 * 60 * 60 * 1000;
  else return base;

  const end = (endDateIso || '').trim();
  if (!end) return base;
  const dEnd = new Date(end);
  if (Number.isNaN(dEnd.getTime())) return base;

  const tfOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const dStart = new Date(dEnd.getTime() - windowMs);
  const startLabel = dStart.toLocaleTimeString(undefined, tfOpts);
  const endLabel = dEnd.toLocaleTimeString(undefined, tfOpts);
  return `${base} · ${startLabel} - ${endLabel}`.replace(/\s+/g, ' ').trim();
}

export function getTokenOutcome(tokenId: string, marketLookup: Record<string, Market>): string {
  const market = lookupMarketByTokenId(tokenId, marketLookup);
  if (!market) return '';
  const tokenIds = market.clobTokenIds || [];
  const norm = normalizeClobTokenId(tokenId);
  if (normalizeClobTokenId(tokenIds[0]) === norm) return 'YES';
  if (normalizeClobTokenId(tokenIds[1]) === norm) return 'NO';
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

export function lookupMarketByTokenId(
  tokenId: string | null | undefined,
  marketLookup: Record<string, Market>,
): Market | undefined {
  const raw = String(tokenId || '').trim();
  if (!raw) return undefined;
  const direct = marketLookup[raw];
  if (direct) return direct;
  const norm = normalizeClobTokenId(raw);
  if (norm && norm !== raw) return marketLookup[norm];
  return undefined;
}

export function isWeatherMarket(
  market: Pick<Market, 'question' | 'eventSlug'> | { question?: string; eventSlug?: string } | null | undefined,
): boolean {
  if (!market) return false;
  const combined = `${market.question || ''} ${market.eventSlug || ''}`.toLowerCase();
  return (
    combined.includes('highest-temperature-in-')
    || combined.includes('lowest-temperature-in-')
    || combined.includes('highest temperature')
    || combined.includes('lowest temperature')
  );
}

/** Polymarket position row → outcome token id (Data API may use `asset`, `asset_id`, or `token_id`). */
export function getPositionClobTokenId(p: Pick<Position, 'asset' | 'asset_id' | 'token_id'>): string {
  return String(p.asset ?? p.asset_id ?? p.token_id ?? '').trim();
}

/** Normalize condition id for compare (0x + lowercase + 64-hex pad when hex). */
export function normalizeConditionIdKey(id: string | null | undefined): string {
  let h = String(id || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('expired:')) return h;
  if (!h.startsWith('0x')) h = `0x${h}`;
  const body = h.slice(2);
  if (!/^[0-9a-f]+$/.test(body) || body.length > 64) return h;
  if (body.length < 64) return `0x${body.padStart(64, '0')}`;
  return h;
}

/**
 * True if outcome token is one of selected market's CLOB ids.
 * Only rejects when both sides have a real conditionId and they disagree
 * (do not compare Gamma numeric `id` vs condition id — that hid My Orders).
 */
export function outcomeTokenBelongsToSelectedMarket(
  tokenId: string,
  selected: Market | null | undefined,
  marketLookup: Record<string, Market>,
): boolean {
  if (!tokenId || !selected?.clobTokenIds?.length) return false;
  const nt = normalizeClobTokenId(tokenId);
  const inSelected = selected.clobTokenIds.some((id) => {
    const s = String(id || '').trim();
    return s === tokenId || normalizeClobTokenId(s) === nt;
  });
  if (!inSelected) return false;
  const row = marketLookup[tokenId] || marketLookup[nt];
  const rowCond = normalizeConditionIdKey(row?.conditionId);
  const selCond = normalizeConditionIdKey(selected.conditionId);
  if (rowCond && selCond && rowCond !== selCond) return false;
  return true;
}

export function orderMatchesSelectedMarket(
  o: Pick<Order, 'asset_id' | 'token_id' | 'market'>,
  selected: Market | null | undefined,
  marketLookup: Record<string, Market>,
): boolean {
  if (!selected) return false;
  const tid = getOrderClobTokenId(o);
  if (tid && outcomeTokenBelongsToSelectedMarket(tid, selected, marketLookup)) return true;
  // Fallback when asset_id missing / stub tokens: match CLOB condition id on order.market.
  const orderCond = normalizeConditionIdKey(o.market);
  const selCond = normalizeConditionIdKey(selected.conditionId || selected.id);
  if (orderCond && selCond && orderCond === selCond && !selCond.startsWith('expired:')) {
    return true;
  }
  return false;
}

export function tradeMatchesSelectedMarket(
  t: Trade,
  selected: Market | null | undefined,
  marketLookup: Record<string, Market>,
): boolean {
  const tid = getTradeClobTokenId(t);
  if (!tid) return false;
  if (!outcomeTokenBelongsToSelectedMarket(tid, selected, marketLookup)) return false;
  const cond = normalizeConditionIdKey(t.conditionId);
  const selCond = normalizeConditionIdKey(selected?.conditionId || selected?.id);
  if (cond && selCond && !selCond.startsWith('expired:') && cond !== selCond) return false;
  return true;
}

export function extractAssetFromMarket(market: Market): AssetName | '' {
  const question = market.question || market.groupItemTitle || '';
  const slug = (market.eventSlug || '').toLowerCase();
  const hay = `${question} ${slug}`;
  // Tickers / names before short crypto tokens that appear inside longer words.
  if (/\bWTI\b/i.test(hay) || slug.startsWith('wti-') || slug.includes('-wti-')) return 'WTI';
  if (
    /\bNatural Gas\b/i.test(question)
    || /\bNATGAS\b/i.test(hay)
    || (/\bNG\b/.test(question) && /gas|natural/i.test(hay))
    || slug.startsWith('ng-')
    || slug.includes('what-price-will-ng-')
    || slug.includes('will-ng-hit-')
  ) return 'NG';
  if (/\bSPY\b/i.test(hay) || /S&P 500/i.test(question) || slug.startsWith('spy-')) return 'SPY';
  if (/\bAAPL\b/i.test(hay) || /\bApple\b/i.test(question) || slug.startsWith('aapl-')) return 'AAPL';
  if (/\bGOOGL?\b/i.test(hay) || /\b(?:Google|Alphabet)\b/i.test(question) || slug.startsWith('googl-')) return 'GOOGL';
  if (/\bNVDA\b/i.test(hay) || /\bNVIDIA\b/i.test(question) || slug.startsWith('nvda-')) return 'NVDA';
  if (/\bAMZN\b/i.test(hay) || /\bAmazon\b/i.test(question) || slug.startsWith('amzn-')) return 'AMZN';
  if (question.includes('Bitcoin') || question.includes('BTC')) return 'BTC';
  if (question.includes('Ethereum') || question.includes('ETH')) return 'ETH';
  if (question.includes('Solana') || question.includes('SOL')) return 'SOL';
  if (question.includes('XRP')) return 'XRP';
  return '';
}

/**
 * When the selected market is expired/closed: Up/Down → soonest live row in the same asset+TF bucket;
 * otherwise → same eventSlug + groupItemTitle (strike row) with next endDate after the current slice.
 */
export function pickNextMarketOnExpiry(
  selected: Market | null,
  nowMs: number,
  upOrDownMarkets: Record<string, Record<string, Market[]>>,
  marketLookup: Record<string, Market>,
): Market | null {
  if (!selected?.endDate) return null;
  const endMs = new Date(selected.endDate).getTime();
  const ended =
    Boolean(selected.closed) || (Number.isFinite(endMs) && endMs <= nowMs);
  if (!ended) return null;

  const isUpDown = !!(
    selected.question?.match(/up\s+or\s+down/i) ||
    selected.eventSlug?.match(/up-or-down|updown/i)
  );
  if (isUpDown) {
    const asset = extractAssetFromMarket(selected);
    const tf = upDownTimeframeKeyFromMarket(selected);
    if (!asset || !tf) return null;
    const live = pickLiveUpDownMarketInTfBucket(upOrDownMarkets[asset]?.[tf], nowMs);
    if (live && live.id !== selected.id) return live;
    return null;
  }

  const slug = (selected.eventSlug || '').trim();
  const strike = (selected.groupItemTitle || '').trim();
  if (!slug || !strike) return null;
  const seen = new Set<string>();
  const candidates: Market[] = [];
  for (const m of Object.values(marketLookup)) {
    if (!m.endDate || m.closed) continue;
    const t = new Date(m.endDate).getTime();
    if (!Number.isFinite(t) || t <= nowMs || t <= endMs) continue;
    if ((m.eventSlug || '').trim() !== slug) continue;
    if ((m.groupItemTitle || '').trim() !== strike) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    candidates.push(m);
  }
  candidates.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  return candidates[0] ?? null;
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

export function formatPriceShort(priceStr: string, asset?: AssetName): string {
  const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '').trim();
  if (cleaned.startsWith('↑') || cleaned.startsWith('↓') || cleaned.startsWith('<') || cleaned.startsWith('>')) {
    const sym = cleaned[0];
    const num = parseStrikeTokenToNumber(cleaned.substring(1));
    if (isNaN(num)) return priceStr;
    if (num >= 1000) return sym + thousandsKPart(num, asset) + 'k';
    return sym + num;
  }
  if (cleaned.includes('-')) {
    const parts = cleaned.split('-');
    const num1 = parseStrikeTokenToNumber(parts[0]);
    const num2 = parseStrikeTokenToNumber(parts[1]);
    if (num1 >= 1000 && num2 >= 1000) {
      return thousandsKPart(num1, asset) + '-' + thousandsKPart(num2, asset) + 'k';
    }
    return num1 + '-' + num2;
  }
  const num = parseStrikeTokenToNumber(cleaned);
  if (num >= 1000) return thousandsKPart(num, asset) + 'k';
  return cleaned;
}

export const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
  WTI: 'text-amber-500',
  NG: 'text-lime-400',
  SPY: 'text-emerald-400',
  AAPL: 'text-gray-200',
  GOOGL: 'text-blue-300',
  NVDA: 'text-green-400',
  AMZN: 'text-orange-300',
  WEATHER: 'text-sky-400',
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

/** TPO trades table: 5s, 2m, 3h, 1d since epoch ms. */
export function formatElapsedSinceMs(ms: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const diff = nowMs - ms;
  if (diff < 0) return '';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function blockTimeToEpochMs(blockTime: number): number {
  if (!blockTime || !Number.isFinite(blockTime)) return 0;
  return blockTime > 1e12 ? blockTime : blockTime * 1000;
}

export function formatWalletTradeTimeWithElapsed(blockTime: number, nowMs: number = Date.now()): string {
  if (!blockTime) return '—';
  const ms = blockTimeToEpochMs(blockTime);
  const base = new Date(ms).toLocaleString().split('/').join('\\');
  const elapsed = formatElapsedSinceMs(ms, nowMs);
  return elapsed ? `${base} (${elapsed})` : base;
}

export function formatWalletTradeTimeBase(blockTime: number): string {
  if (!blockTime) return '—';
  const ms = blockTimeToEpochMs(blockTime);
  return new Date(ms).toLocaleString().split('/').join('\\');
}

export function tradeElapsedAgeSec(blockTime: number, nowMs: number = Date.now()): number {
  const ms = blockTimeToEpochMs(blockTime);
  if (!ms) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((nowMs - ms) / 1000));
}

/** Wallet trades elapsed tail: green <15s, yellow <60s, else gray. */
export function tradeElapsedColorClass(ageSec: number): string {
  if (ageSec < 15) return 'text-emerald-400';
  if (ageSec < 60) return 'text-yellow-400';
  return 'text-gray-500';
}
