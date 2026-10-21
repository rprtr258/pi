import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";

// Rules enforcing the project's type-shape conventions:
// - object shapes are `type X = {...}` aliases, never `interface`
// - type-literal members are separated by commas, never semicolons
// Note: member-delimiter-style left typescript-eslint core in v8; it now lives
// in ESLint Stylistic (TS rules under the @stylistic/ts/ prefix).
export default tseslint.config(
// Mirror tsconfig "exclude": these trees are fixtures/generated output kept
// outside the TS project, and with projectService the parser can't handle files
// that belong to no tsconfig, so eslint must skip them too.
{
  ignores: [
    "**/node_modules/**",
    "**/runs/**",
    "**/broken/**",
    "harness-self-improvement/loop/suite/**",
    "harness-self-improvement/loop/suite-replay/**",
  ],
},
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {projectService: true, tsconfigRootDir: import.meta.dirname},
    },
    plugins: {"@typescript-eslint": tseslint.plugin, "@stylistic/ts": stylistic},
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@stylistic/ts/member-delimiter-style": [
        "error",
        {
          multiline: {delimiter: "comma", requireLast: true},
          singleline: {delimiter: "comma", requireLast: false},
        },
      ],
    },
  },
);
