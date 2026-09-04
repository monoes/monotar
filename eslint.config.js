import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/next-env.d.ts",
      ".claude/**",
      ".agents/**",
      ".codex/**",
      ".gemini/**",
      ".kimi-code/**",
      ".opencode/**",
      ".swarm/**",
      ".monomind/**",
    ],
  }
);
