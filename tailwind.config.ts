import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#08090C",
          card: "#11141A",
          elevated: "#181C24",
        },
        border: {
          DEFAULT: "#252B36",
        },
        text: {
          DEFAULT: "#FFFFFF",
          mute: "#8B92A0",
        },
        accent: {
          DEFAULT: "#00D9A3",
          alt: "#00B8E6",
        },
        signal: {
          red: "#FF4757",
          orange: "#FF8A3D",
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      backgroundImage: {
        'gradient-accent': 'linear-gradient(135deg, #00D9A3 0%, #00B8E6 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
