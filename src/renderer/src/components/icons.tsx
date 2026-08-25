// Small hand-rolled line icons (no icon-font dependency). Each inherits
// color from its parent via currentColor, sized via the `size` prop.

interface IconProps {
  size?: number;
  className?: string;
}

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconMark({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 2.5 21 12 12 21.5 3 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconRefresh({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.5 4.5M20 20v-5h-5" />
    </svg>
  );
}

export function IconCheck({ size = 10, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 12.5 9.5 18 20 6" />
    </svg>
  );
}

export function IconNote({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14.5 3v4.5H19M8 12h7M8 16h5" />
    </svg>
  );
}

export function IconArrowRight({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconExternal({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
      <path d="M14 4h6v6M20 4 11 13" />
    </svg>
  );
}

export function IconPlus({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 4v16M4 12h16" />
    </svg>
  );
}

export function IconChevronLeft({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M15 5 8 12l7 7" />
    </svg>
  );
}

export function IconChevronRight({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function IconVideo({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10 21 7v10l-6-3Z" />
    </svg>
  );
}

export function IconTrash({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconPencil({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      <path d="M14.5 5.5l3 3" />
    </svg>
  );
}

export function IconX({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}

export function IconGrip({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="currentColor">
      <circle cx="8" cy="6" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="8" cy="18" r="1.5" />
      <circle cx="16" cy="6" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
      <circle cx="16" cy="18" r="1.5" />
    </svg>
  );
}

export function IconPlay({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M6 4.5v15l14-7.5Z" />
    </svg>
  );
}

export function IconStop({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

export function IconFolder({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

export function IconArchive({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 13h4" />
    </svg>
  );
}

export function IconSkip({ size = 11, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconFlame({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 2.5c1 3 -3 4.5 -3 8a3 3 0 0 0 6 0c0-1.2-.6-1.9-1-2.5.9.3 3 1.7 3 5a5 5 0 0 1-10 0c0-4.5 3-6.5 5-10.5Z" />
    </svg>
  );
}

export function IconGear({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 3.5v2.4M12 18.1v2.4M4.9 6.1l1.7 1.7M17.4 16.2l1.7 1.7M3.5 12h2.4M18.1 12h2.4M4.9 17.9l1.7-1.7M17.4 7.8l1.7-1.7" />
    </svg>
  );
}

export function IconEye({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconClock({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l4 2.5" />
    </svg>
  );
}

export function IconEyeOff({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a15.5 15.5 0 0 1-3.6 4.4M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7c1.4 0 2.6-.3 3.7-.8" />
      <path d="M9.9 10c-.6.5-.9 1.2-.9 2a3 3 0 0 0 3 3c.8 0 1.5-.3 2-.9" />
    </svg>
  );
}

// Matches the raw SVG string lib/codeCopyButton.ts embeds for the live
// editor's copy button (that surface renders into dangerouslySetInnerHTML-
// adjacent widget DOM, not React, so it can't import this component) — same
// path data, kept in sync by hand so the two surfaces look identical.
export function IconCopy({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

// ---- markdown formatting toolbar (components/MarkdownToolbar.tsx) ----
// Heavier stroke than the rest of the set: these render at 13px next to
// text, where the default 1.75 reads as washed out.

const glyph = { ...base, strokeWidth: 2 };

export function IconBold({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M7 4h6.5a4 4 0 0 1 0 8H7Z" />
      <path d="M7 12h7.5a4 4 0 0 1 0 8H7Z" />
    </svg>
  );
}

export function IconItalic({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M15 4H9M15 20H9M14 4 10 20" />
    </svg>
  );
}

export function IconStrikethrough({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M4 12h16" />
      <path d="M16.5 7A4.5 4.5 0 0 0 8 8.5c0 1.4 1 2.6 3 3.5" />
      <path d="M7.5 17a4.5 4.5 0 0 0 8.5-1.5c0-.8-.3-1.5-.8-2" />
    </svg>
  );
}

export function IconCodeInline({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
    </svg>
  );
}

export function IconCodeBlock({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m9 10-2 2 2 2M15 10l2 2-2 2" />
    </svg>
  );
}

export function IconLink({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6" />
    </svg>
  );
}

export function IconH1({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M4 5v14M12 5v14M4 12h8" />
      <path d="M16.5 10.5 19 9v10" />
    </svg>
  );
}

export function IconH2({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M4 5v14M12 5v14M4 12h8" />
      <path d="M16 10.5a2.5 2.5 0 0 1 4.3 1.7c0 2.3-4.3 3.6-4.3 6.8h4.5" />
    </svg>
  );
}

export function IconH3({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M4 5v14M12 5v14M4 12h8" />
      <path d="M16 9.5h4.3L17.5 13a2.75 2.75 0 1 1-1.8 4.8" />
    </svg>
  );
}

export function IconList({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  );
}

export function IconListOrdered({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5.5 5.5 5v4M3.5 15.2a1.6 1.6 0 0 1 2.8 1c0 1.3-2.8 2-2.8 3.3h3" />
    </svg>
  );
}

export function IconTask({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <rect x="3" y="4" width="8" height="8" rx="1.5" />
      <path d="m4.5 8 2 2 3-3.5M14 8h7M3 17h18" />
    </svg>
  );
}

export function IconQuote({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M4 5v14" />
      <path d="M9 8h11M9 12h11M9 16h7" />
    </svg>
  );
}

export function IconTable({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M9.5 9.5V20M3 15h18" />
    </svg>
  );
}

export function IconOutline({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...glyph}>
      <path d="M4 5h16M4 10h11M4 15h13M4 20h8" />
    </svg>
  );
}

export function IconBranch({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="7" cy="5" r="2.25" />
      <circle cx="7" cy="19" r="2.25" />
      <circle cx="17" cy="9" r="2.25" />
      <path d="M7 7.25v9.5M17 11.25c0 3-3.5 3.25-6.25 4" />
    </svg>
  );
}
