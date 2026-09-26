import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // The PDF renderers use @react-pdf/renderer's <Image>, not an HTML <img>.
  // It has no alt prop, so jsx-a11y's check is a false positive here.
  {
    files: ["src/lib/ProposalPDF.tsx", "src/lib/InvoicePDF.tsx"],
    rules: { "jsx-a11y/alt-text": "off" },
  },
]);

export default eslintConfig;
