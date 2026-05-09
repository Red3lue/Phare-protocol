import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bone: {
          DEFAULT: '#f7f3eb',
          50:  '#fbf9f4',
          100: '#f7f3eb',
          200: '#ede5d4',
          300: '#ddd0b4',
          900: '#1f1c16',
        },
        ink: {
          DEFAULT: '#0d1311',
          900: '#0d1311',
          700: '#1c2926',
          500: '#3a4a45',
          300: '#7a8b85',
        },
        turq: {
          DEFAULT: '#1ed1c5',
          50:  '#e8fbf9',
          100: '#c6f4ee',
          200: '#8ee9de',
          300: '#5cdfd0',
          400: '#1ed1c5',
          500: '#14b3a8',
          600: '#0e8d84',
          700: '#0a6964',
          900: '#053734',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        brutal: '0.25em',
      },
      opacity: {
        '5': '0.05',
        '8': '0.08',
        '12': '0.12',
        '15': '0.15',
        '22': '0.22',
        '35': '0.35',
        '45': '0.45',
        '55': '0.55',
        '65': '0.65',
        '85': '0.85',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow':  'spin 60s linear infinite',
      },
      backdropBlur: {
        glass: '18px',
      },
    },
  },
  plugins: [],
};

export default config;
