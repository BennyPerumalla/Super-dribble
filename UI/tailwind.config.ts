import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Audio Equalizer Theme Colors
        eq: {
          background: "hsl(var(--eq-background))",
          surface: "hsl(var(--eq-surface))",
          "surface-light": "hsl(var(--eq-surface-light))",
          border: "hsl(var(--eq-border))",
          text: "hsl(var(--eq-text))",
          "text-dim": "hsl(var(--eq-text-dim))",
          accent: "hsl(var(--eq-accent))",
          "accent-glow": "hsl(var(--eq-accent-glow))",
          "slider-track": "hsl(var(--eq-slider-track))",
          "slider-thumb": "hsl(var(--eq-slider-thumb))",
          "frequency-bar": "hsl(var(--eq-frequency-bar))",
          volume: "hsl(var(--eq-volume))",
          danger: "hsl(var(--eq-danger))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "eq-pulse": {
          "0%, 100%": {
            opacity: "1",
          },
          "50%": {
            opacity: "0.7",
          },
        },
        "eq-bounce": {
          "0%, 100%": {
            transform: "scaleY(1)",
          },
          "50%": {
            transform: "scaleY(1.2)",
          },
        },
        "eq-glow": {
          "0%, 100%": {
            boxShadow: "0 0 20px hsla(var(--eq-accent-glow), 0.3)",
          },
          "50%": {
            boxShadow: "0 0 30px hsla(var(--eq-accent-glow), 0.6)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "eq-pulse": "eq-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "eq-bounce": "eq-bounce 1s ease-in-out infinite",
        "eq-glow": "eq-glow 2s ease-in-out infinite",
      },
      fontFamily: {
        mono: [
          "JetBrains Mono",
          "Monaco",
          "Cascadia Code",
          "Segoe UI Mono",
          "Roboto Mono",
          "Oxygen Mono",
          "Ubuntu Monospace",
          "Source Code Pro",
          "Fira Code",
          "Droid Sans Mono",
          "Courier New",
          "monospace",
        ],
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
