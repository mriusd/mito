type SidebarDataSourceBadgeProps = {
  source: 'onchain' | 'polymarket';
};

export function SidebarDataSourceBadge({ source }: SidebarDataSourceBadgeProps) {
  const onchain = source === 'onchain';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 ${
        onchain ? 'border border-purple-500/70 bg-purple-600/35' : 'border border-[#2d57ff] bg-[#2f5cff]'
      }`}
      title={
        onchain
          ? 'Data from Polygon on-chain feed (header CHAIN).'
          : "Data from Polymarket API (header API)."
      }
    >
      <img
        src={onchain ? '/polygon-logo.png' : '/polymarket-favicon.ico'}
        alt={onchain ? 'Polygon' : 'Polymarket'}
        className="h-3 w-3 rounded-[2px] object-contain"
        style={onchain ? undefined : { filter: 'brightness(0) invert(1)' }}
      />
    </span>
  );
}
