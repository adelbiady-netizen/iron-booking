/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        iron: {
          green:        'rgb(var(--iron-green) / <alpha-value>)',
          'green-light':'rgb(var(--iron-green-light) / <alpha-value>)',
          bg:           'rgb(var(--iron-bg) / <alpha-value>)',
          card:         'rgb(var(--iron-card) / <alpha-value>)',
          border:       'rgb(var(--iron-border) / <alpha-value>)',
          text:         'rgb(var(--iron-text) / <alpha-value>)',
          muted:        'rgb(var(--iron-muted) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'Inter',
          'Segoe UI', 'system-ui', 'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
