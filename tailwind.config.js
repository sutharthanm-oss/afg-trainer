/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      // Remaps Tailwind's default "slate" and "teal" scales to the exact brand colors
      // used on the landing page. Every existing className in the app (bg-slate-900,
      // text-teal-600, border-slate-200, etc.) automatically picks up the new palette —
      // nothing in App.jsx itself needs to change for the colors to match.
      colors: {
        slate: {
          50: '#F7F9FB',
          100: '#EEF2F5',
          200: '#E4E9EE',
          300: '#C7D1D9',
          400: '#7C8B99',
          500: '#647587',
          600: '#516170',
          700: '#384656',
          800: '#223142',
          900: '#0F2036',
        },
        teal: {
          50: '#EAF4F5',
          100: '#D5E9EB',
          200: '#ABD3D7',
          300: '#5EEAD4',
          400: '#45A3AF',
          500: '#2E8B98',
          600: '#237683',
          700: '#1C5F69',
          800: '#164850',
          900: '#0F3239',
        },
      },
      fontFamily: {
        // Becomes the new default body font everywhere, matching the landing page.
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
        // Not applied automatically anywhere — add the "font-display" class to specific
        // headline/brand elements (like the CallSpar title) to match the landing page's
        // headline treatment.
        display: ['"Space Grotesk"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
