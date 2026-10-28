/**
 * Tailwind CSS v4 ships its PostCSS integration in `@tailwindcss/postcss`.
 *
 * Autoprefixer was removed with this upgrade: v4 handles vendor prefixing itself (verified by
 * comparing prefix counts in the built CSS before and after — release report §K). Keeping both
 * would run two prefixing passes over the same rules.
 */
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
