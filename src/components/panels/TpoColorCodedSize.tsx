/** Distinct hues for digits 0–9 so size can be read by color from afar. */
const DIGIT_HEX = [
  '#c4c4c4', // 0 ash
  '#ff1a1a', // 1 red
  '#ff7a00', // 2 orange
  '#ffe600', // 3 yellow
  '#22ff66', // 4 green
  '#00f0ff', // 5 cyan
  '#2f6bff', // 6 blue
  '#b44cff', // 7 violet
  '#ff3dc8', // 8 magenta
  '#ffffff', // 9 white
] as const;

/** Locale-formatted integer with per-digit color + black stroke. */
export function TpoColorCodedSize({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <>—</>;
  const text = Math.trunc(value).toLocaleString();
  return (
    <span className="tpo-color-digits font-mono font-bold tabular-nums">
      {[...text].map((ch, i) => {
        if (ch >= '0' && ch <= '9') {
          return (
            <span key={i} className="tpo-digit-stroke" style={{ color: DIGIT_HEX[ch.charCodeAt(0) - 48] }}>
              {ch}
            </span>
          );
        }
        return (
          <span key={i} className="text-gray-500">
            {ch}
          </span>
        );
      })}
    </span>
  );
}
