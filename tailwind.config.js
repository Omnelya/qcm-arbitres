/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Fond neutre clair et encre : lisibles en plein soleil, sur le terrain.
        // Maquette v3 « sobre, chaleureux, rassurant » (13/10/2026)
        ink: '#1E2A24',
        canvas: '#F3F5F3',
        surface: '#FFFFFF',
        border: '#E2E7E3',
        muted: '#66736C',
        ambre: { DEFAULT: '#E39B32', fonce: '#B4741A', doux: '#FDF3E3' },
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
        sans: ['Figtree', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '12px',
      },
      boxShadow: {
        carte: '0 1px 2px rgba(30,42,36,.06), 0 6px 18px rgba(30,42,36,.07)',
        'carte-haute': '0 2px 4px rgba(30,42,36,.08), 0 12px 28px rgba(30,42,36,.12)',
      },
    },
  },
  plugins: [],
};
