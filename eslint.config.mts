import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: {...globals.browser, ...globals.node} } },
  tseslint.configs.recommended,
  // Allow underscore-prefixed variables (convention for intentionally unused vars)
  { files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"], rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } },
  pluginReact.configs.flat.recommended,
  { settings: { react: { version: "19.0.0" } } },
  // React 17+ with react-jsx transform: React import not required for JSX
  { files: ["**/*.{jsx,tsx}"], rules: { "react/react-in-jsx-scope": "off" } },
]);
