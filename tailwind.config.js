/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Noto Serif TC"', 'serif'],
        body: ['"Noto Sans TC"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        field: {
          night: '#0e1a12',
          grass: '#16301f',
          grass2: '#1c3a26',
          dirt: '#8a5a3c',
          chalk: '#f2ead9',
          floodlight: '#ffe9a8',
        },
      },
      boxShadow: {
        dugout: '0 0 0 1px rgba(242,234,217,0.08), 0 12px 30px -12px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};
