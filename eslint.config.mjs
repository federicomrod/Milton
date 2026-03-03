import js from "@eslint/js";
import typescriptEslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default typescriptEslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      ".turbo/**",
      "dist/**",
    ],
  },
  js.configs.recommended,
  ...typescriptEslint.configs.recommended,
  // Node scripts (require, __dirname, console) — avoid no-undef errors
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        exports: "writable",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@next/next/no-img-element": "error",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // Downgrade strict rules to warnings
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "prefer-const": "warn",
      "no-case-declarations": "warn",
      "no-useless-escape": "warn",
      "react/no-unescaped-entities": "warn",
      "no-empty": "warn",
      "@typescript-eslint/no-require-imports": "warn",
    },
  }
);
