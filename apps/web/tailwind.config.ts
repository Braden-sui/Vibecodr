import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        "vc-soft": "0 10px 45px -25px rgba(15, 23, 42, 0.35)",
        "vc-soft-lg": "0 18px 65px -30px rgba(8, 15, 35, 0.45)",
      },
      backgroundImage: {
        "vc-shell":
          "radial-gradient(100% 60% at 10% 10%, rgba(99, 102, 241, 0.08), transparent 45%), radial-gradient(120% 70% at 90% 0%, rgba(16, 185, 129, 0.08), transparent 50%), linear-gradient(180deg, rgba(15, 23, 42, 0.02), rgba(15, 23, 42, 0.06))",
        "vc-hero":
          "radial-gradient(80% 60% at 20% 10%, rgba(59, 130, 246, 0.14), transparent 50%), radial-gradient(90% 70% at 80% 20%, rgba(236, 72, 153, 0.12), transparent 50%), linear-gradient(135deg, rgba(15, 23, 42, 0.04), rgba(15, 23, 42, 0.06))",
        "vc-glow":
          "radial-gradient(65% 65% at 50% 35%, rgba(125, 211, 252, 0.14), transparent 55%), radial-gradient(35% 35% at 80% 25%, rgba(167, 139, 250, 0.2), transparent 60%)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "float-soft": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "float-soft": "float-soft 5s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
