import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        brand: {
          primary: '#171717',
          'primary-hover': '#262626',
          'primary-light': '#404040',
          'primary-dark': '#0a0a0a',
        },
      },
    },
  },
  plugins: [],
}

export default config
