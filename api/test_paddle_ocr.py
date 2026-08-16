from __future__ import annotations

import hashlib
import hmac
import os
import time
import unittest

from paddle_ocr import MAX_BODY_BYTES, map_paddle_output, verify_request


class PaddleSecurityTests(unittest.TestCase):
    def setUp(self):
        os.environ["OCR_INTERNAL_SECRET"] = "test-secret"

    def signed(self, body: bytes, timestamp: int | None = None):
        stamp = str(timestamp if timestamp is not None else int(time.time()))
        digest = hashlib.sha256(body).hexdigest()
        signature = hmac.new(b"test-secret", f"{stamp}.{digest}".encode(), hashlib.sha256).hexdigest()
        return {"x-ocr-timestamp": stamp, "x-ocr-signature": signature, "content-type": "application/octet-stream"}

    def test_valid_hmac(self):
        body = b"image"
        self.assertIsNone(verify_request(self.signed(body), body))

    def test_bad_hmac_and_stale_timestamp_fail_closed(self):
        body = b"image"
        headers = self.signed(body)
        headers["x-ocr-signature"] = "bad"
        self.assertEqual(verify_request(headers, body), "OCR_PADDLE_UNAVAILABLE")
        self.assertEqual(verify_request(self.signed(body, int(time.time()) - 61), body), "OCR_PADDLE_UNAVAILABLE")

    def test_oversized_body_fails_closed(self):
        body = b"x" * (MAX_BODY_BYTES + 1)
        self.assertEqual(verify_request(self.signed(body), body), "OCR_PADDLE_UNAVAILABLE")

    def test_wrong_content_type_fails_closed(self):
        body = b"image"
        headers = self.signed(body)
        headers["content-type"] = "application/json"
        self.assertEqual(verify_request(headers, body), "OCR_PADDLE_UNAVAILABLE")

    def test_maps_paddle_arrays(self):
        mapped = map_paddle_output({"rec_texts": ["amount"], "rec_scores": [0.9], "rec_boxes": [[1, 2, 3, 4]]}, "PADDLE_COLOR")
        self.assertEqual(mapped, [{"text": "amount", "score": 0.9, "box": [1.0, 2.0, 3.0, 4.0]}])

    def test_drops_invalid_boxes(self):
        mapped = map_paddle_output({"rec_texts": ["amount", "other"], "rec_scores": [0.9, 0.8], "rec_boxes": [[3, 4, 1, 2], [1, 2, 3, 4]]}, "PADDLE_COLOR")
        self.assertEqual(mapped, [{"text": "other", "score": 0.8, "box": [1.0, 2.0, 3.0, 4.0]}])


if __name__ == "__main__":
    unittest.main()
