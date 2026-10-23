/** The Argus mark: an abstract eye made of two arcs and a dot. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <path d="M3 17c3.6-6.2 8-9.3 13-9.3s9.4 3.1 13 9.3" fill="none" stroke="var(--brand)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M8.5 20.5c2.2 2.6 4.7 3.9 7.5 3.9s5.3-1.3 7.5-3.9" fill="none" stroke="var(--brand)" strokeOpacity=".45" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="16.4" r="3.4" fill="var(--brand)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <Mark />
      <span className="text-[16px] font-semibold tracking-[-0.02em] text-ink">Argus</span>
    </span>
  );
}
