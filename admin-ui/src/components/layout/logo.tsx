import { useId } from "react";

/**
 * tinbase barrel/database logo rendered as an inline SVG.
 *
 * Mirrors the artwork used on the marketing site (and the app favicon):
 * a gradient-filled tin body with a mid-body seam and a lighter lid.
 *
 * @param props.size - Width and height of the logo in pixels. Defaults to 24.
 */
export function Logo({ size = 24 }: { size?: number }) {
  const id = useId();
  const body = `${id}-body`;
  const lid = `${id}-lid`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={body} x1="30" y1="30" x2="92" y2="102" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10b981" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
        <linearGradient id={lid} x1="26" y1="19" x2="94" y2="49" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6ee7b7" />
          <stop offset="1" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <path d="M26 34v52c0 8.4 15.2 15.2 34 15.2s34-6.8 34-15.2V34Z" fill={`url(#${body})`} />
      <path
        d="M26 60c0 8.4 15.2 15.2 34 15.2S94 68.4 94 60"
        stroke="#6ee7b7"
        strokeWidth="3"
        fill="none"
      />
      <ellipse cx="60" cy="34" rx="34" ry="15" fill={`url(#${lid})`} />
      <ellipse
        cx="60"
        cy="34"
        rx="25"
        ry="10"
        fill="none"
        stroke="#059669"
        strokeOpacity="0.5"
        strokeWidth="2.5"
      />
    </svg>
  );
}
