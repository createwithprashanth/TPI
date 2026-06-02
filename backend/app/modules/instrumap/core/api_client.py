"""
OCR client — replaced Google Vision API with EasyOCR (local, no cloud dependency).
The GoogleVisionClient stub is kept so any remaining import references don't break.
"""
import logging

logger = logging.getLogger(__name__)


class GoogleVisionClient:
    """Stub kept for import compatibility. OCR is now handled by EasyOCR in text_engine.py."""
    def __init__(self):
        self.client = None
