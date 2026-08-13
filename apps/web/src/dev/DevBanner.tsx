/**
 * A strip of hazard tape across the top of the dev server, so a tab that has
 * been open for an hour is never mistaken for the deployed app. It is rendered
 * behind `import.meta.env.DEV`, which Vite replaces with `false` in a build —
 * the branch and this module are then dropped from the bundle entirely.
 */

/*
 * Routes size themselves against the viewport (`h-dvh`), so a banner added
 * above them would push the last row of every screen out of sight. The rules
 * below take the banner's height back off those utilities.
 *
 * They are unlayered, and Tailwind's utilities live in `@layer utilities`, so
 * these win the cascade regardless of specificity. Only elements that measure
 * the whole viewport are touched; a `fixed` overlay still covers the tape,
 * which is what a modal should do.
 */
const HEIGHT = '1.75rem';

const OFFSET_VIEWPORT_HEIGHTS = `
  .h-dvh { height: calc(100dvh - ${HEIGHT}); }
  .min-h-dvh { min-height: calc(100dvh - ${HEIGHT}); }
`;

/* Diagonal amber-and-black tape. Deliberately outside the theme's palette:
 * this is not part of the app, and should not look like it is. A muted amber
 * rather than a hazard yellow — this sits above every screen all day, so it
 * has to read as a marker without being the brightest thing on the display. */
const TAPE = 'repeating-linear-gradient(45deg, #a8760a 0 0.75rem, #1a1a1a 0.75rem 1.5rem)';

export function DevBanner() {
  return (
    <>
      <style>{OFFSET_VIEWPORT_HEIGHTS}</style>
      <div
        role="status"
        className="flex items-center justify-center overflow-hidden select-none"
        style={{ height: HEIGHT, background: TAPE }}
      >
        {/*
         * The label is a solid plate, not text laid straight onto the tape:
         * against diagonal stripes the letters lose their edges every time a
         * stroke crosses a yellow band. White on near-black also holds up where
         * yellow-on-black would sit inside its own stripe and disappear.
         */}
        <span
          className="rounded-sm px-2.5 py-0.5 font-mono text-xs font-bold tracking-widest uppercase"
          style={{ background: '#111111', color: '#ffffff', outline: '2px solid #111111' }}
        >
          Development build
        </span>
      </div>
    </>
  );
}
