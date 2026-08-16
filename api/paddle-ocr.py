"""Private, fail-closed PaddleOCR shadow/fallback function.

The handler deliberately contains no logging of request bytes, OCR text, or
model output. Model initialization is process-local and the semaphore limits a
warm Vercel process to one inference at a time.
"""

from __future__ import annotations

import base64
import io
import hashlib
import hmac
import json
import os
from pathlib import Path
import threading
import time
from typing import Any, Iterable

MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_ITEMS = 200
MAX_TEXT_LENGTH = 256
_model_lock = threading.Lock()
_inference_lock = threading.BoundedSemaphore(1)
_engine: Any | None = None


def _headers(request: Any) -> dict[str, str]:
    source = getattr(request, "headers", request if isinstance(request, dict) else {}) or {}
    return {str(key).lower(): str(value) for key, value in dict(source).items()}


def _body(request: Any) -> bytes:
    value = getattr(request, "body", request.get("body", b"") if isinstance(request, dict) else b"")
    if isinstance(value, str):
        try:
            return base64.b64decode(value, validate=True)
        except Exception:
            return value.encode()
    return bytes(value or b"")


def verify_request(headers: dict[str, str], body: bytes, now: int | None = None) -> str | None:
    if len(body) > MAX_BODY_BYTES:
        return "OCR_PADDLE_UNAVAILABLE"
    timestamp = headers.get("x-ocr-timestamp", "")
    signature = headers.get("x-ocr-signature", "")
    secret = os.environ.get("OCR_INTERNAL_SECRET", "")
    try:
        parsed_timestamp = int(timestamp)
    except (TypeError, ValueError):
        return "OCR_PADDLE_UNAVAILABLE"
    current = int(time.time()) if now is None else now
    if abs(current - parsed_timestamp) > 60 or not secret:
        return "OCR_PADDLE_UNAVAILABLE"
    digest = hashlib.sha256(body).hexdigest()
    expected = hmac.new(secret.encode(), f"{timestamp}.{digest}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return "OCR_PADDLE_UNAVAILABLE"
    if headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/octet-stream":
        return "OCR_PADDLE_UNAVAILABLE"
    return None


def _response(status: int, payload: dict[str, Any]) -> Any:
    body = json.dumps(payload, separators=(",", ":"))
    try:
        from vercel_runtime import Response  # type: ignore

        return Response(body, status=status, headers={"content-type": "application/json", "cache-control": "no-store"})
    except Exception:
        return {"statusCode": status, "headers": {"content-type": "application/json", "cache-control": "no-store"}, "body": body}


def _load_engine() -> Any | None:
    global _engine
    if _engine is not None:
        return _engine
    with _model_lock:
        if _engine is not None:
            return _engine
        model_dir = os.environ.get("PADDLE_MODEL_DIR", "")
        det_dir = os.environ.get("PADDLE_DET_MODEL_DIR", "") or str(Path(model_dir) / "PP-OCRv5_mobile_det")
        rec_dir = os.environ.get("PADDLE_REC_MODEL_DIR", "") or str(Path(model_dir) / "th_PP-OCRv5_mobile_rec")
        # Local model directories are mandatory. Passing model names without
        # paths would let PaddleOCR attempt a runtime download, which is not
        # allowed for this private fallback.
        if not model_dir or not os.path.isdir(det_dir) or not os.path.isdir(rec_dir):
            return None
        try:
            from paddleocr import PaddleOCR  # type: ignore

            _engine = PaddleOCR(
                text_detection_model_name="PP-OCRv5_mobile_det",
                text_detection_model_dir=det_dir,
                text_recognition_model_name="th_PP-OCRv5_mobile_rec",
                text_recognition_model_dir=rec_dir,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                engine="onnxruntime",
                engine_config={
                    "device_type": "cpu",
                    "providers": ["CPUExecutionProvider"],
                    "intra_op_num_threads": 2,
                    "inter_op_num_threads": 1,
                    "execution_mode": "sequential",
                },
            )
        except Exception:
            _engine = None
    return _engine


def _valid_image(body: bytes) -> bool:
    try:
        from PIL import Image  # type: ignore

        with Image.open(io.BytesIO(body)) as image:
            image.verify()
        return True
    except Exception:
        return False


def _to_box(value: Any) -> list[float] | None:
    try:
        if hasattr(value, "tolist"):
            value = value.tolist()
        if isinstance(value, (list, tuple)) and len(value) == 4 and all(isinstance(item, (int, float)) for item in value):
            return [float(item) for item in value]
        if isinstance(value, (list, tuple)) and len(value) == 4 and all(isinstance(item, (list, tuple)) and len(item) == 2 for item in value):
            points = [(float(point[0]), float(point[1])) for point in value]
            return [min(point[0] for point in points), min(point[1] for point in points), max(point[0] for point in points), max(point[1] for point in points)]
    except Exception:
        return None
    return None


def map_paddle_output(output: Any, variant: str) -> list[dict[str, Any]]:
    """Map PaddleOCR 3.x rec_texts/rec_scores/rec_boxes into bounded items."""
    if not isinstance(output, dict):
        return []
    texts = output.get("rec_texts", [])
    scores = output.get("rec_scores", [])
    boxes = output.get("rec_boxes", [])
    if not isinstance(texts, Iterable) or not isinstance(scores, Iterable) or not isinstance(boxes, Iterable):
        return []
    items: list[dict[str, Any]] = []
    for text, score, box in zip(texts, scores, boxes):
        if not isinstance(text, str) or not text.strip() or not isinstance(score, (int, float)):
            continue
        bounded_text = text[:MAX_TEXT_LENGTH]
        bounded_score = max(0.0, min(1.0, float(score)))
        bounded_box = _to_box(box)
        if bounded_box is None or bounded_box[2] <= bounded_box[0] or bounded_box[3] <= bounded_box[1]:
            continue
        items.append({"text": bounded_text, "score": bounded_score, "box": bounded_box})
        if len(items) >= MAX_ITEMS:
            break
    return items


def _predict(engine: Any, body: bytes, variant: str) -> list[dict[str, Any]]:
    try:
        from PIL import Image  # type: ignore
        import numpy as np  # type: ignore

        with Image.open(io.BytesIO(body)) as image:
            array = np.asarray(image.convert("RGB"))
        result = engine.predict(input=array)
        first = next(iter(result), None)
        return map_paddle_output(first, variant) if first is not None else []
    except Exception:
        return []


def _contrast_view(body: bytes) -> bytes:
    """Build deterministic 3x3 local-contrast view without OpenCV.

    Pillow's per-tile equalization keeps this optional bundle small. It is
    intentionally a separate input view; duplicate model output must never be
    presented as independent evidence.
    """
    from PIL import Image, ImageOps  # type: ignore

    with Image.open(io.BytesIO(body)) as image:
        source = image.convert("L")
        output = Image.new("L", source.size)
        width, height = source.size
        for row in range(3):
            for column in range(3):
                left = width * column // 3
                top = height * row // 3
                right = width * (column + 1) // 3
                bottom = height * (row + 1) // 3
                tile = source.crop((left, top, right, bottom))
                output.paste(ImageOps.equalize(tile), (left, top))
        result = io.BytesIO()
        output.convert("RGB").save(result, format="JPEG", quality=88, optimize=True)
        return result.getvalue()


def handler(request: Any) -> Any:
    body = _body(request)
    error = verify_request(_headers(request), body)
    if error:
        return _response(401, {"code": error})
    if not _valid_image(body):
        return _response(400, {"code": "OCR_PADDLE_UNAVAILABLE"})
    if not _inference_lock.acquire(blocking=False):
        return _response(429, {"code": "OCR_PADDLE_UNAVAILABLE"})
    try:
        engine = _load_engine()
        if engine is None:
            return _response(503, {"code": "OCR_PADDLE_UNAVAILABLE"})
        color_items = _predict(engine, body, "PADDLE_COLOR")
        try:
            contrast_body = _contrast_view(body)
            contrast_items = _predict(engine, contrast_body, "PADDLE_CLAHE")
        except Exception:
            contrast_items = []
        variants = [{"id": "PADDLE_COLOR", "items": color_items}]
        if contrast_items:
            variants.append({"id": "PADDLE_CLAHE", "items": contrast_items})
        return _response(200, {"version": 1, "variants": variants})
    finally:
        _inference_lock.release()
