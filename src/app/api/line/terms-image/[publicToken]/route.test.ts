import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getState: vi.fn(), readFile: vi.fn() }));
vi.mock("@/lib/sheets/settings", () => ({ getLineTermsImageState: mocks.getState }));
vi.mock("@/lib/storage/drive-client", () => ({ readDriveTermsImageFile: mocks.readFile }));

import { GET } from "./route";

const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const version = {
  versionId: "terms_11111111111111111111111111111111",
  publicToken: token,
  driveFileId: "terms-file-12345",
  mimeType: "image/png" as const,
  byteLength: 8,
  originalName: "terms.png",
  uploadedAt: "2026-08-15T01:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getState.mockResolvedValue({ activeVersionId: version.versionId, versions: [version] });
  mocks.readFile.mockResolvedValue({ bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), declaredMimeType: "image/png" });
});

describe("public LINE T&S image", () => {
  it("serves a registered historical or active token with immutable headers", async () => {
    const response = await GET(new Request(`https://pay.example/api/line/terms-image/${token}`), { params: Promise.resolve({ publicToken: token }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.readFile).toHaveBeenCalledWith("terms-file-12345");
  });

  it("rejects malformed and unknown tokens before Drive access", async () => {
    const malformed = await GET(new Request("https://pay.example/api/line/terms-image/bad"), { params: Promise.resolve({ publicToken: "bad" }) });
    expect(malformed.status).toBe(404);
    expect(mocks.getState).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();

    mocks.getState.mockResolvedValueOnce({ activeVersionId: version.versionId, versions: [version] });
    const unknownToken = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const unknown = await GET(new Request(`https://pay.example/api/line/terms-image/${unknownToken}`), { params: Promise.resolve({ publicToken: unknownToken }) });
    expect(unknown.status).toBe(404);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("returns a generic unavailable response for Drive and byte-validation failures", async () => {
    mocks.readFile.mockRejectedValueOnce(new Error("private Google body"));
    const unavailable = await GET(new Request(`https://pay.example/api/line/terms-image/${token}`), { params: Promise.resolve({ publicToken: token }) });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toBe("Service Unavailable");

    mocks.readFile.mockResolvedValueOnce({ bytes: new Uint8Array([255, 216, 255]), declaredMimeType: "image/jpeg" });
    const mismatched = await GET(new Request(`https://pay.example/api/line/terms-image/${token}`), { params: Promise.resolve({ publicToken: token }) });
    expect(mismatched.status).toBe(503);
  });
});
