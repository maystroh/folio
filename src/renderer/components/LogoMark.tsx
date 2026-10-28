export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="logo-mark"
    >
      <path
        d="M4.5 5.25c2.9-.85 5.5-.3 7.5 1.5 2-1.8 4.6-2.35 7.5-1.5v12.4c-2.9-.8-5.5-.28-7.5 1.5-2-1.78-4.6-2.3-7.5-1.5V5.25Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <path
        d="M12 6.75v12.4"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path d="M7.4 9h2.1M7.4 11.4h2.1M14.5 9h2.1M14.5 11.4h2.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
