/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Fond neutre clair et encre : lisibles en plein soleil, sur le terrain.
        ink: '#1A1D1B',
        canvas: '#F7F7F5',
        surface: '#FFFFFF',
        border: '#E3E1DB',
        muted: '#6B6B64',
        // Vert profond : couleur principale de l'application.
        // Couleurs "vertes" de l'application, pilotées par des variables CSS
        // (src/index.css) : sur les écrans d'un QCM, elles prennent la
        // couleur de la structure du QCM (voir src/hooks/useCouleurQcm.ts).
        pitch: {
          DEFAULT: 'rgb(var(--pitch-rgb) / <alpha-value>)',
          dark: 'rgb(var(--pitch-dark-rgb) / <alpha-value>)',
          light: 'rgb(var(--pitch-light-rgb) / <alpha-value>)',
        },
        // Doré et rouge brique : clin d'œil aux cartons jaune/rouge de l'arbitrage,
        // utilisés pour les états d'avertissement et de danger.
        card: {
          yellow: '#C99A2E',
          'yellow-bg': '#FBF3E2',
          red: '#B23A2E',
          'red-bg': '#FBEAE8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '10px',
      },
    },
  },
  plugins: [],
};
