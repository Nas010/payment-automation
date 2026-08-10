import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tesseract starts a Node worker from its package at runtime. Keep the package
  // external so Vercel traces that worker script into the serverless function.
  serverExternalPackages: ["tesseract.js"],
  // The worker loads the OCR WebAssembly binary from disk at runtime. It is not
  // a JavaScript import, so include it explicitly in the upload function trace.
  outputFileTracingIncludes: {
    "/api/payment/[token]/submit": [
      "./node_modules/tesseract.js/node_modules/tesseract.js-core/**/*.wasm",
    ],
  },
};

export default nextConfig;
