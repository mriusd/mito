/** Pale hues (TPO column palette) for digit 0–9. */
const DIGIT_HEX = [
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
 * Every digit 0–9 colored by its value; punctuation muted.
 */
export function TpoColorCodedText({ text }: { text: string }) {
  if (!text) return <>—</>;
  return (
    <span className="tpo-color-digits font-mono font-bold tabular-nums text-gray-300">
      {[...text].map((ch, i) => {
        if (ch >= '0' && ch <= '9') {
          return (
            <span
              key={i}
              className="tpo-digit-stroke"
              style={{ color: DIGIT_HEX[ch.charCodeAt(0) - 48] }}
            >
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

/** Locale-formatted size with 1 decimal: each digit color-coded. */
export function TpoColorCodedSize({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <>—</>;
  // One decimal; locale grouping on the integer part only.
  const rounded = Math.round(value * 10) / 10;
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs);
  const frac = Math.round((abs - whole) * 10);
  const text = `${neg ? '-' : ''}${whole.toLocaleString()}.${frac}`;
  return <TpoColorCodedText text={text} />;
}
