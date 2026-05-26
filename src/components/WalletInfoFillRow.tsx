import { memo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { OnchainFillRow } from '../api';
import type { Market } from '../types';
import {
  fillOutcomeDisplay,
  fmtUsd2En,
  isLedgerFillRow,
  WALLET_TRADE_PENDING_ROW_BG,
} from '../lib/walletInfoFillRows';
import { openPolygonscanTx, polygonscanTxUrl } from '../lib/polygonscanLink';
import { LiveWalletTradeTimeCell } from './WalletTradeTimeCell';

const FILL_ROW_CAP = 200;

export function capWalletInfoFills(fills: OnchainFillRow[]): OnchainFillRow[] {
  return fills.length > FILL_ROW_CAP ? fills.slice(0, FILL_ROW_CAP) : fills;
}

export function walletInfoFillRowKey(f: OnchainFillRow): string {
  if (f.pending) return f.pendingId || `pending:${f.txHash}:${f.tokenId}`;
  return `${f.txHash ?? ''}:${f.logIndex ?? ''}:${f.tokenId ?? ''}`;
}

export const WalletInfoFillRow = memo(function WalletInfoFillRow({
  fill: f,
  wallet,
  market,
}: {
  fill: OnchainFillRow;
  wallet: string;
  market: Market | Record<string, unknown>;
}) {
  const bt = Number((f as { blockTime?: number }).blockTime ?? 0);
  const isPending = f.pending === true;
  const takerMark =
    f.isTaker === true && (!isPending || f.priceApproximate === true) ? 'T' : '';

  if (isLedgerFillRow(f)) {
    const sz = Number(f.size);
    const pr = f.price;
    const priceFinite = pr != null && Number.isFinite(pr);
    const sizeFinite = Number.isFinite(sz);
    const priceApprox = f.priceApproximate === true;
    const priceLabel = priceFinite
      ? `${(pr * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}¢`
      : '—';
    const priceCls = priceApprox ? 'text-right text-gray-500 italic tabular-nums' : 'text-right text-gray-300 tabular-nums';
    const usdc = priceFinite && sizeFinite ? pr * sz : NaN;
    const usdcLabel = Number.isFinite(usdc) ? `$${fmtUsd2En(usdc)}` : '—';
    const usdcCls = priceApprox ? 'text-right text-yellow-400/60 italic' : 'text-right text-yellow-400';
    const feeN = Number(f.fee);
    const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
    const { text: sideLabel, tone: sideTone } = fillOutcomeDisplay(f, market as Market);
    const sideCls =
      sideTone === 'yes' ? 'text-green-400' : sideTone === 'no' ? 'text-red-400' : 'text-gray-300';
    const action = String(f.action ?? '').trim();
    const actionU = action.toUpperCase();
    const actionCls =
      actionU === 'BUY'
        ? 'text-green-400'
        : actionU === 'SELL'
          ? 'text-red-400'
          : actionU === 'SPLIT' || actionU === 'MERGE'
            ? 'text-purple-400'
            : actionU === 'REDEEM'
              ? 'text-blue-400'
              : 'text-gray-300';
    return (
      <tr className={`border-b border-gray-800 ${isPending ? `${WALLET_TRADE_PENDING_ROW_BG} italic` : ''}`}>
        <td className="py-0.5">
          {isPending ? (
            <span className="text-gray-500">pending...</span>
          ) : (
            <LiveWalletTradeTimeCell blockTime={bt} />
          )}
        </td>
        <td className={actionCls}>{action || '—'}</td>
        <td className={sideCls}>{sideLabel}</td>
        <td className="text-center text-amber-300 font-bold tabular-nums px-0">{takerMark}</td>
        <td className="text-right tabular-nums">
          {sizeFinite ? sz.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
        </td>
        <td className={priceCls} title={priceApprox ? 'Limit price from mempool — actual exec price pending' : undefined}>{priceLabel}</td>
        <td className={usdcCls} title={priceApprox ? 'Estimated from limit price' : undefined}>{usdcLabel}</td>
        <td className="text-right text-yellow-400/80">{feeLabel}</td>
        <td className="text-center px-0">
          {f.txHash || isPending ? (
            (() => {
              const scanUrl = polygonscanTxUrl(f.txHash, isPending ? f.pendingId : undefined);
              if (!scanUrl) return '—';
              return (
                <a
                  href={scanUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-gray-400 hover:text-cyan-300"
                  title={isPending ? 'Open pending tx on Polygonscan' : `Open tx ${f.txHash} on Polygonscan`}
                  aria-label={isPending ? 'Open pending transaction on Polygonscan' : 'Open transaction on Polygonscan'}
                  onClick={(e) => {
                    if (!isPending) return;
                    e.preventDefault();
                    if (!openPolygonscanTx(f.txHash, f.pendingId)) {
                      throw new Error('polygonscan tx link missing hash');
                    }
                  }}
                >
                  <ExternalLink size={12} />
                </a>
              );
            })()
          ) : (
            '—'
          )}
        </td>
      </tr>
    );
  }

  const isSplitMerge = f.orderHash === 'SPLIT' || f.orderHash === 'MERGE';
  if (isSplitMerge) {
    const label = String(f.orderHash);
    const amount = Number(f.makerAmount ?? 0);
    const feeN = Number(f.fee ?? 0);
    const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
    return (
      <tr className="border-b border-gray-800">
        <td className="py-0.5">
          <LiveWalletTradeTimeCell blockTime={bt} />
        </td>
        <td className="text-purple-400" colSpan={2}>
          {label}
        </td>
        <td className="text-center text-amber-300 font-bold px-0">{takerMark}</td>
        <td className="text-right tabular-nums">
          {Number.isFinite(amount)
            ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—'}
        </td>
        <td className="text-right text-gray-500">—</td>
        <td className="text-right text-gray-500 tabular-nums">
          {Number.isFinite(amount) ? `$${fmtUsd2En(amount)}` : '—'}
        </td>
        <td className="text-right text-yellow-400/80">{feeLabel}</td>
        <td className="text-center px-0">
          {f.txHash ? (
            <a
              href={`https://polygonscan.com/tx/${f.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-gray-400 hover:text-cyan-300"
              title={`Open tx ${f.txHash} on Polygonscan`}
              aria-label="Open transaction on Polygonscan"
            >
              <ExternalLink size={12} />
            </a>
          ) : (
            '—'
          )}
        </td>
      </tr>
    );
  }

  const walletLower = wallet.toLowerCase();
  const isTaker = (f.taker || '').toLowerCase() === walletLower;
  const walletPaysUsdc = (isTaker && f.takerAssetId === '0') || (!isTaker && f.makerAssetId === '0');
  const wa = String(f.walletAccountSide || '').toUpperCase();
  const action = wa === 'BUY' || wa === 'SELL' ? wa : walletPaysUsdc ? 'BUY' : 'SELL';
  const shares = walletPaysUsdc
    ? isTaker
      ? f.makerAmount
      : f.takerAmount
    : isTaker
      ? f.takerAmount
      : f.makerAmount;
  const usdc = walletPaysUsdc
    ? isTaker
      ? f.takerAmount
      : f.makerAmount
    : isTaker
      ? f.makerAmount
      : f.takerAmount;
  const nShares = Number(shares);
  const nUsdc = Number(usdc);
  const pricePerShare =
    nShares > 1e-9 && Number.isFinite(nShares) && Number.isFinite(nUsdc) ? nUsdc / nShares : NaN;
  const priceLabel = Number.isFinite(pricePerShare)
    ? `${(pricePerShare * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}¢`
    : '—';
  const { text: sideText, tone: sideTone } = fillOutcomeDisplay(f, market as Market);
  const sideCls = sideTone === 'yes' ? 'text-green-400' : sideTone === 'no' ? 'text-red-400' : 'text-gray-300';
  const feeN = Number(f.fee ?? 0);
  const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';

  return (
    <tr className="border-b border-gray-800">
      <td className="py-0.5">
        <LiveWalletTradeTimeCell blockTime={bt} />
      </td>
      <td className={action === 'BUY' ? 'text-green-400' : 'text-red-400'}>{action}</td>
      <td className={sideCls}>{sideText}</td>
      <td className="text-center text-amber-300 font-bold tabular-nums px-0">{takerMark}</td>
      <td className="text-right tabular-nums">
        {Number.isFinite(nShares)
          ? nShares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '—'}
      </td>
      <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
      <td className="text-right text-yellow-400 tabular-nums">
        {Number.isFinite(nUsdc) ? `$${fmtUsd2En(nUsdc)}` : '—'}
      </td>
      <td className="text-right text-yellow-400/80 tabular-nums">{feeLabel}</td>
      <td className="text-center px-0">
        {f.txHash ? (
          <a
            href={`https://polygonscan.com/tx/${f.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-gray-400 hover:text-cyan-300"
            title={`Open tx ${f.txHash} on Polygonscan`}
            aria-label="Open transaction on Polygonscan"
          >
            <ExternalLink size={12} />
          </a>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}, (prev, next) => prev.fill === next.fill && prev.wallet === next.wallet && prev.market === next.market);
