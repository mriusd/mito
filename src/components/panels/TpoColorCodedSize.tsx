/** Pale hues (TPO column palette) for leading digit 0–9. */
const LEAD_DIGIT_HEX = [
  '#9ca3af', // 0 gray-400
  '#fca5a5', // 1 red-300
  '#fdba74', // 2 orange-300
  '#fde047', // 3 yellow-300
  '#86efac', // 4 green-300
  '#67e8f9', // 5 cyan-300
  '#93c5fd', // 6 blue-300
  '#d8b4fe', // 7 purple-300
  '#f9a8d4', // 8 pink-300
  '#e7e5e4', // 9 stone-200
] as const;

/** Locale-formatted size: only first digit colored; rest pale gray + black stroke. */
export function TpoColorCodedSize({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <>—</>;
  const text = Math.trunc(value).toLocaleString();
  let coloredFirst = false;
  return (
    <span className="tpo-color-digits font-mono font-bold tabular-nums text-gray-300">
      {[...text].map((ch, i) => {
        if (ch >= '0' && ch <= '9') {
          if (!coloredFirst) {
            coloredFirst = true;
            return (
              <span
                key={i}
                className="tpo-digit-stroke"
                style={{ color: LEAD_DIGIT_HEX[ch.charCodeAt(0) - 48] }}
              >
                {ch}
              </span>
            );
          }
          return (
            <span key={i} className="tpo-digit-stroke text-gray-300">
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
