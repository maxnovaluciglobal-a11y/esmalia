/**
 * Patty como personaje (landing A+): la cara en el violeta de la IA, con la
 * chispa ocre. Decorativa: el texto que la acompaña lleva el significado.
 */
export function PattyCara({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 44" aria-hidden="true" focusable="false" className={className}>
      <path
        d="M22 3c9.5 0 17 6.6 17 17.5S31.5 41 22 41 5 31.4 5 20.5 12.5 3 22 3z"
        fill="var(--ai)"
      />
      <path
        d="M10 14c3-5 7.5-7.5 12-7.5"
        stroke="var(--ai-border)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse className="eye" cx="16.5" cy="21" rx="2.3" ry="3.4" fill="var(--background)" />
      <ellipse className="eye" cx="27.5" cy="21" rx="2.3" ry="3.4" fill="var(--background)" />
      <path
        d="M17 29q5 4 10 0"
        stroke="var(--background)"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M36 4l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="var(--brand-on-night)" />
    </svg>
  );
}
