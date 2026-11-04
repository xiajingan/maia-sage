import js from "@eslint/js";
import ts from "typescript-eslint";
import vue from "eslint-plugin-vue";
export default ts.config(
  { ignores: ["dist/**", "vendor/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        document: "readonly",
        innerWidth: "readonly",
      },
    },
  },
  { rules: { "vue/multi-word-component-names": "off" } },
  { files: ["src/main.ts"], rules: { "vue/one-component-per-file": "off" } },
);
