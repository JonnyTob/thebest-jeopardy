/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        jeopardy: {
          blue: '#060CE9',
          gold: '#FFD700',
          dark: '#0A0A2E',
        },
      },
      fontFamily: {
        swiss: ['"Swiss 721"', '"Arial Black"', 'Impact', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
