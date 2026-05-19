import { memo, useMemo } from 'react';
import { WALLET_ADDRESS_GLYPH_BG, walletAddressGlyphModel } from '../lib/walletAddressGlyph';

type WalletAddressGlyphProps = {
  address: string;
  /** Rendered width/height in CSS px. */
  size?: number;
  className?: string;
  title?: string;
};

export const WalletAddressGlyph = memo(function WalletAddressGlyph({
  address,
  size = 14,
  className = '',
  title,
}: WalletAddressGlyphProps) {
  const model = useMemo(() => walletAddressGlyphModel(address), [address]);
  if (!model) return null;

  const { grid, bg, cells } = model;
  const label = title ?? address;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      shapeRendering="crispEdges"
      className={`box-border inline-block shrink-0 align-middle rounded-[1px] border border-black bg-black ${className}`.trim()}
      aria-hidden={!label}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
    >
      <rect width={grid} height={grid} fill={bg || WALLET_ADDRESS_GLYPH_BG} />
      {cells.map((row, y) =>
        row.map((cell, x) =>
          cell.filled ? <rect key={`${y}-${x}`} x={x} y={y} width={1} height={1} fill={cell.color} /> : null,
        ),
      )}
    </svg>
  );
});
