const SIDEBAR_SOURCE_ICON_CLS = 'h-2 w-2 rounded-[1px] object-contain';

type SidebarDataSourceBadgeProps = {
  source: 'onchain' | 'polymarket';
};

export function SidebarDataSourceBadge({ source }: SidebarDataSourceBadgeProps) {
  const onchain = source === 'onchain';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-0.5 py-px ${
        onchain ? 'border border-purple-500/70 bg-purple-600/35' : 'border border-[#2d57ff] bg-[#2f5cff]'
      }`}
      title={
        onchain
          ? 'Data from Polygon on-chain feed (header CHAIN).'
          : "Data from Polymarket API (header API)."
      }
    >
      <img
        src={onchain ? '/polygon-logo.svg' : '/polymarket-favicon.ico'}
        alt={onchain ? 'Polygon' : 'Polymarket'}
        className={SIDEBAR_SOURCE_ICON_CLS}
        style={onchain ? undefined : { filter: 'brightness(0) invert(1)' }}
      />
    </span>
  );
}
