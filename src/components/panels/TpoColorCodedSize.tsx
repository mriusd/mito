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

/**
 * First significant digit (1–9) colored; leading 0s gray (digit-0 hue).
 * Rest of digits pale gray + black stroke; punctuation muted.
 */
export function TpoColorCodedText({ text }: { text: string }) {
  if (!text) return <>—</>;
  let coloredFirst = false;
  return (
    <span className="tpo-color-digits font-mono font-bold tabular-nums text-gray-300">
      {[...text].map((ch, i) => {
        if (ch >= '1' && ch <= '9') {
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
        if (ch === '0') {
          // Leading zeros (before first 1–9): gray digit hue. Later zeros: pale.
          if (!coloredFirst) {
            return (
              <span
                key={i}
                className="tpo-digit-stroke"
                style={{ color: LEAD_DIGIT_HEX[0] }}
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

/** Locale-formatted integer size: first significant digit colored. */
export function TpoColorCodedSize({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <>—</>;
  return <TpoColorCodedText text={Math.trunc(value).toLocaleString()} />;
}
