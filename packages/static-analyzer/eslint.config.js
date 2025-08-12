/* eslint no-undef:0 */
const globals = require("globals");
const { default: json } = require("@eslint/json");
const pluginJs = require("@eslint/js");
const node = require("eslint-plugin-node");
const tslint = require("typescript-eslint");
const redos = require("eslint-plugin-redos");
const sonarjs = require("eslint-plugin-sonarjs");
const securityPlugin = require("eslint-plugin-security");
const { plugin: ex } = require("eslint-plugin-exception-handling");
const prettierPlugin = require("eslint-plugin-prettier/recommended");

module.exports = [
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    ignores: [
      "node_modules",
      "dist",
      "eslint.config.js",
      ".idea",
      ".vscode",
      ".git",
      ".husky",
      ".github",
      "coverage",
      "build",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  pluginJs.configs.recommended,
  ...tslint.configs.recommended,
  prettierPlugin,
  securityPlugin.configs.recommended,
  sonarjs.configs.recommended,
  {
    plugins: {
      ex,
      node,
      redos,
    },
  },
  {
    rules: {
      "ex/no-unhandled": "error",
      "@typescript-eslint/interface-name-prefix": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/ban-ts-ignore": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/ban-types": "off",
      "detect-object-injection": "off",
      "security/detect-object-injection": "off",
      "sonarjs/updated-loop-counter": "off",
      "sonarjs/pseudo-random": "off",
      "sonarjs/no-all-duplicated-branches": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-redundant-jump": "off",
      "@typescript-eslint/no-require-imports": "off",
      "security/detect-non-literal-fs-filename": "off",
      "sonarjs/void-use": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "prettier/prettier": [
        "error",
        {},
        {
          usePrettierrc: true,
        },
      ],
    },
  },
  {
    files: ["**/*.json"],
    language: "json/json",
    plugins: {
      json,
    },
    rules: {
      "json/no-duplicate-keys": "error",
      "no-restricted-syntax": [
        "warn",
        "Null", // AST selector for `null`
      ],
    },
  },
];
