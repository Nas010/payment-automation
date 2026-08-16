import path from "node:path";

/**
 * Tesseract language data is checked into the application root. Keeping the
 * path local prevents a request from reaching a CDN or mutating a shared
 * cache. Vercel traces these two files explicitly in next.config.ts.
 */
export function localTesseractOptions(): { langPath: string; gzip: boolean; cacheMethod: "none" } {
  return {
    langPath: path.resolve(process.cwd()),
    gzip: false,
    cacheMethod: "none",
  };
}
