/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Consolas", "monospace"],
      },
      colors: {
        ink: { DEFAULT: "#0B1222", 2: "#1E293B", 3: "#475569", 4: "#64748B" },
        haze: { 50: "#F7F8FC", 100: "#EEF1F8", 200: "#E2E7F1", 300: "#CBD3E3" },
        orbit: { 400: "#7C8CF8", 500: "#5B6CF0", 600: "#4352D6" },
        flame: { 50: "#FFF6ED", 100: "#FFEAD5", 300: "#FDB022", 400: "#F79009", 500: "#F04438", 600: "#D92D20", 700: "#B42318", 800: "#912018" },
      },
      boxShadow: {
        glass: "0 1px 0 rgba(255,255,255,.9) inset, 0 12px 40px -18px rgba(15,23,42,.25), 0 2px 6px -2px rgba(15,23,42,.06)",
        lift: "0 18px 50px -20px rgba(67,82,214,.35)",
      },
      keyframes: {
        orbit: { to: { transform: "rotate(360deg)" } },
        pulseDot: { "0%,100%": { opacity: ".25", transform: "scale(.8)" }, "50%": { opacity: "1", transform: "scale(1.15)" } },
        rise: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        rise: "rise .5s cubic-bezier(.2,.7,.2,1) both",
        pulseDot: "pulseDot 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
