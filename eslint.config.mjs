import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/.wrangler/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `const { secret, ...rest } = x` is how secrets are stripped before storing or returning settings.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    // Plain scripts the marketing site loads as-is.
    files: ["apps/web/public/**/*.js"],
    languageOptions: { globals: { document: "readonly", localStorage: "readonly" } },
  },
);
