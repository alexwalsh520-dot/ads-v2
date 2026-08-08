// Icons ported verbatim from the v1 ads export (public/ads-tracker-export.html):
// the shared Icon wrapper (14px, stroke 1.4, viewBox 24) plus the calendar,
// caret, and check glyphs the filter controls use.

function Icon({ d, size = 14, stroke = 1.4 }: { d: React.ReactNode; size?: number; stroke?: number }) {
  return (
    <svg
      className="i"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d}
    </svg>
  );
}

export function IcCal() {
  return (
    <Icon
      d={
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </>
      }
    />
  );
}

export function IcCaret() {
  return (
    <svg
      width="9"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M1 1l4 4 4-4" />
    </svg>
  );
}

export function IcCheck() {
  return <Icon d={<path d="M20 6L9 17l-5-5" />} />;
}

export function IcPlus() {
  return (
    <Icon
      d={
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      }
    />
  );
}

export function IcEdit() {
  return (
    <Icon
      d={
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </>
      }
    />
  );
}

// The settings gear, matched to the sidebar's line-icon Settings glyph (lucide,
// rendered at 18px there) so the v2 header gear is the same visual weight/size.
export function IcGear({ size = 18 }: { size?: number }) {
  return (
    <Icon
      size={size}
      stroke={1.6}
      d={
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </>
      }
    />
  );
}
