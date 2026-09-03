import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lima: "#B5D334",
        oliva: "#7A9330",
        bosque: "#3E531D",
        carbon: "#181C14",
        carbonDeep: "#11130E",
        hueso: "#FDFBF7",
        civicBlue: "#3273EC",
        civicOrange: "#F26A36",
      },
      fontFamily: {
        display: ["'Outfit'", "sans-serif"],
        body: ["'Plus Jakarta Sans'", "sans-serif"],
      },
      borderRadius: {
        squishy: "2rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
