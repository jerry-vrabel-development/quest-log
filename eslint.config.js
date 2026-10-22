import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", ".wrangler/", "coverage/", "playwright-report/", "test-results/"] },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  { files: ["public/**/*.js"], languageOptions: { globals: globals.browser } },
  { files: ["public/sw.js"], languageOptions: { sourceType: "script", globals: globals.serviceworker } },
  { files: ["src/**/*.js"], languageOptions: { globals: globals.serviceworker } },
  {
    files: ["test/**/*.js", "e2e/**/*.js", "scripts/**/*.mjs", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
];
