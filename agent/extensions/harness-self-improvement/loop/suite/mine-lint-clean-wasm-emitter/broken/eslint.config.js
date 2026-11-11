import js from "@eslint/js";

export default [
  {
    ignores: ["node_modules/"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-console": "error",
      "no-debugger": "error",
    },
  },
];
