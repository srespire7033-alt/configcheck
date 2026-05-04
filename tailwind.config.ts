import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // src/lib produces classNames at runtime (e.g. getScoreColor returning
    // 'text-lime-500'). If Tailwind doesn't scan it, those classes get
    // purged from the bundle and render as default text color.
    "./src/lib/**/*.{js,ts}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // OrgPrism brand palette — the four faces of the hollow-hex logo.
        // Use these tokens (e.g. text-brand-purple) in marketing surfaces and
        // category accents. Severity colors stay in red/amber/green via
        // Tailwind defaults to keep the two systems separate.
        'brand-purple': '#A855F7',
        'brand-orange': '#F97316',
        'brand-sky': '#38BDF8',
        'brand-indigo': '#1E40AF',
      },
    },
  },
  plugins: [],
};
export default config;
