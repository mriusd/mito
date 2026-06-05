import type { AssetName, Market } from '../types';
import type { HlCryptoLeg, HlCryptoRow, HlOutcomesSnapshot } from './hyperliquidOutcomesFeed';

export type HlAssetGridMarkets = {
  above: Market[];
  between: Market[];
  upOrDown: Record<string, Market[]>;
};

function parseTargetPrice(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function hlLegToMarket(row: HlCryptoRow, leg: HlCryptoLeg): Market {
  const yesMid = leg.yesMid > 0 ? leg.yesMid : leg.chancePct / 100;
  return {
    id: `hl-${leg.outcomeId}`,
    question: `${row.title} — ${leg.label}`,
    eventTitle: row.title,
    eventSlug: row.eventSlug || row.id,
    groupItemTitle: leg.strikeLabel || leg.label,
    endDate: row.endDate,
    clobTokenIds: leg.clobTokenIds,
    bestBid: yesMid > 0 ? yesMid : undefined,
    bestAsk: yesMid > 0 ? yesMid : undefined,
    closed: row.closed,
  };
}

function hlAboveRowToMarket(row: HlCryptoRow): Market {
  const yesMid = row.chancePct != null && row.chancePct > 0 ? row.chancePct / 100 : 0;
  const ptb = parseTargetPrice(row.targetPrice);
  return {
    id: row.id,
    question: row.title,
    eventTitle: row.title,
    eventSlug: row.eventSlug || row.id,
    groupItemTitle: row.strikeLabel || '',
    endDate: row.endDate,
    clobTokenIds: row.clobTokenIds ?? [],
    bestBid: yesMid > 0 ? yesMid : undefined,
    bestAsk: yesMid > 0 ? yesMid : undefined,
    closed: row.closed,
    priceToBeat: ptb,
  };
}

/** Map HL crypto snapshot into Polymarket-style above / between / up-down buckets for AssetMarketTable. */
export function hlSnapshotToAssetGrid(
  snap: HlOutcomesSnapshot | null,
  asset: AssetName,
): HlAssetGridMarkets {
  const above: Market[] = [];
  const between: Market[] = [];
  const upOrDown: Record<string, Market[]> = {
    '5m': [],
    '15m': [],
    '1h': [],
    '4h': [],
    '24h': [],
  };

  for (const row of snap?.rows ?? []) {
    if (row.asset !== asset) continue;

    if (row.kind === 'above') {
      const m = hlAboveRowToMarket(row);
      above.push(m);
      const tf = row.period === '1d' ? '24h' : row.period;
      if (tf && upOrDown[tf]) {
        upOrDown[tf].push(m);
      }
      continue;
    }

    if (row.kind === 'range' && row.legs) {
      for (const leg of row.legs) {
        const m = hlLegToMarket(row, leg);
        switch (leg.legKind) {
          case 'between':
            between.push(m);
            break;
          case 'below':
            between.push(m);
            break;
          case 'above':
            above.push(m);
            break;
          default:
            break;
        }
      }
    }
  }

  return { above, between, upOrDown };
}
