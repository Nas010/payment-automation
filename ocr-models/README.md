# PaddleOCR model bundle

The private fallback is disabled by default. Before enabling it in a preview,
place the two pinned ONNX model directories named in `MANIFEST.json` under the
deployment's `PADDLE_MODEL_DIR`, record their SHA-256 values in the manifest,
and run the Python/security, latency, memory, and private-regression gates.
The handler selects PaddleOCR's `onnxruntime` engine with CPU execution,
two intra-op threads, one inter-op thread, and sequential scheduling.

The request handler never downloads models at runtime and returns the fixed
`OCR_PADDLE_UNAVAILABLE` code when the bundle is absent or invalid.
