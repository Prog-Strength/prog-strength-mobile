// Tailwind v3 with the NativeWind preset. The preset swaps the default
// preflight/base layer for one that produces React Native-compatible
// styles, and adds primitives like `text-foreground` that map to the
// CSS variables defined in global.css.
//
// The `content` globs feed Tailwind's purge — utility classes the
// scanner never sees are stripped from the final bundle. Keep these
// in sync with where we author JSX.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Single dark palette for v1 — the web app is dark-only, so we
      // mirror it here. CSS variables let us flip to light later
      // without changing every className.
      colors: {
        background: "#0a0a0b",
        surface: "#18181b",
        border: "#27272a",
        foreground: "#fafafa",
        muted: "#a1a1aa",
        accent: "#3b82f6",
        "accent-fg": "#ffffff",
        danger: "#ef4444",
      },
    },
  },
  plugins: [],
};
