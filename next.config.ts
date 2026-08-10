import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tesseract starts a Node worker from its package at runtime. Keep the package
  // external so Vercel traces that worker script into the serverless function.
  serverExternalPackages: ["tesseract.js"],
};

export default nextConfig;
