"""Importable test shim for the Vercel ``paddle-ocr.py`` function."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

_spec = spec_from_file_location("_paddle_ocr_impl", Path(__file__).with_name("paddle-ocr.py"))
if _spec is None or _spec.loader is None:
    raise ImportError("Paddle OCR function is unavailable")
_module = module_from_spec(_spec)
_spec.loader.exec_module(_module)

MAX_BODY_BYTES = _module.MAX_BODY_BYTES
verify_request = _module.verify_request
map_paddle_output = _module.map_paddle_output
