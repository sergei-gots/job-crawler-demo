import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "src/generated/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/auth/auth.middleware.ts"],
    rules: {
      // `declare global { namespace Express { ... } }` is the standard TS pattern for
      // augmenting Express's Request type — the namespace here isn't a code-organization one.
      "@typescript-eslint/no-namespace": "off",
    },
  },
);
