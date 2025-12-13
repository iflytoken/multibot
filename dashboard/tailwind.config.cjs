/ /** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: "#020617",
          800: "#0b1220",
          700: "#111827"
        }
      }
    }
  },
  plugins: []
};
