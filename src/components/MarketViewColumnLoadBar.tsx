export function MarketViewColumnLoadBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="mb-1 h-0.5 w-full shrink-0 overflow-hidden rounded-full bg-gray-800/90"
      role="progressbar"
      aria-label="Loading"
    >
      <div className="market-view-column-loadbar h-full w-1/3 rounded-full bg-cyan-400/90" />
    </div>
  );
}
