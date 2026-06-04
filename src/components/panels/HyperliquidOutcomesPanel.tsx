import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { Market } from '../../types';
import { ASSET_COLORS } from '../../types';
import {
  fetchHyperliquidOutcomesSnapshot,
  hlRowToMarket,
  useHyperliquidOutcomesConnected,
  useHyperliquidOutcomesConnection,
  useHyperliquidOutcomesSnapshot,
  type HlCryptoLeg,
  type HlCryptoRow,
} from '../../lib/hyperliquidOutcomesFeed';

function fmtChance(pct: number | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return '—';
  return `${Math.round(pct)}%`;
}

function HlOutcomeRow({
  row,
  showPast,
  selectedMarketId,
  onPick,
}: {
  row: HlCryptoRow;
  showPast: boolean;
  selectedMarketId: string | null;
  onPick: (m: Market, outcome?: 'YES' | 'NO') => void;
}) {
  if (!showPast && row.closed) return null;

  const assetColor = ASSET_COLORS[row.asset] || 'text-white';
  const opacity = row.closed ? 'opacity-50' : '';

  if (row.kind === 'above') {
    const m = hlRowToMarket(row);
    const selected = selectedMarketId === m.id;
    return (
      <tr className={`hover:bg-gray-800/50 ${opacity}`}>
        <td className="px-2 py-2 border-b border-gray-700/50 text-[11px]">
          <button
            type="button"
            className={`text-left hover:text-blue-400 ${assetColor} font-medium ${selected ? 'underline' : ''}`}
            onClick={() => onPick(m, 'YES')}
          >
            {row.title}
          </button>
        </td>
        <td className="px-2 py-2 border-b border-gray-700/50 text-[11px] text-right tabular-nums text-white">
          {fmtChance(row.chancePct)}
        </td>
      </tr>
    );
  }

  const legs = row.legs ?? [];

  return (
    <tr className={`hover:bg-gray-800/50 ${opacity}`}>
      <td className="px-2 py-2 border-b border-gray-700/50 text-[11px]">
        <div className={`font-medium ${assetColor}`}>{row.title}</div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-gray-400">
          {legs.map((leg) => (
            <HlLegChip
              key={leg.outcomeId}
              row={row}
              leg={leg}
              selected={selectedMarketId === `hl-${leg.outcomeId}`}
              onPick={onPick}
            />
          ))}
        </div>
      </td>
      <td className="px-2 py-2 border-b border-gray-700/50 text-[11px] text-right tabular-nums text-gray-500">
        —
      </td>
    </tr>
  );
}

function HlLegChip({
  row,
  leg,
  selected,
  onPick,
}: {
  row: HlCryptoRow;
  leg: HlCryptoLeg;
  selected: boolean;
  onPick: (m: Market, outcome?: 'YES' | 'NO') => void;
}) {
  return (
    <button
      type="button"
      className={`hover:text-blue-400 ${selected ? 'text-blue-300 underline' : ''}`}
      onClick={() => onPick(hlRowToMarket(row, leg), 'YES')}
    >
      {leg.label} {fmtChance(leg.chancePct)}
    </button>
  );
}

function HyperliquidOutcomesPanelInner() {
  useHyperliquidOutcomesConnection(true);
  const connected = useHyperliquidOutcomesConnected();
  const snap = useHyperliquidOutcomesSnapshot();
  const [showPast, setShowPast] = useState(false);
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id ?? null);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);

  useEffect(() => {
    if (snap != null) return;
    void fetchHyperliquidOutcomesSnapshot();
  }, [snap]);

  const handlePick = useCallback(
    (market: Market, outcome: 'YES' | 'NO' = 'YES') => {
      setSelectedMarket(market);
      setSidebarOpen(true);
      setSidebarOutcome(outcome);
    },
    [setSelectedMarket, setSidebarOpen, setSidebarOutcome],
  );

  const rows = useMemo(() => snap?.rows ?? [], [snap?.rows]);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 h-full flex flex-col min-h-0">
      <div className="panel-header shrink-0">
        <h3 className="text-sm font-bold mb-2 flex items-center gap-2 text-cyan-300">
          Hyperliquid Outcomes
          <span
            className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
            title={connected ? 'Live' : 'Disconnected'}
          />
          <label className="no-drag inline-flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer font-normal">
            <input
              type="checkbox"
              checked={showPast}
              onChange={(e) => setShowPast(e.target.checked)}
              className="cursor-pointer w-3 h-3"
            />
            Past
          </label>
        </h3>
        <p className="text-[10px] text-gray-500 mb-2">Crypto only — above (24h) and range (between / below / above)</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!snap ? (
          <div className="text-gray-500 text-center py-4 text-xs">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-gray-500 text-center py-4 text-xs">No crypto outcomes</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-900">
              <tr>
                <th className="px-2 py-1 text-left text-[10px] text-gray-400 font-normal border-b border-gray-700">
                  Outcome
                </th>
                <th className="px-2 py-1 text-right text-[10px] text-gray-400 font-normal border-b border-gray-700 w-20">
                  % Chance
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <HlOutcomeRow
                  key={row.id}
                  row={row}
                  showPast={showPast}
                  selectedMarketId={selectedMarketId}
                  onPick={handlePick}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export const HyperliquidOutcomesPanel = memo(HyperliquidOutcomesPanelInner);
