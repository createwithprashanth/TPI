import logging

from google.cloud import vision
from .config import GOOGLE_APPLICATION_CREDENTIALS_PATH

logger = logging.getLogger(__name__)


class GoogleVisionClient:
    def __init__(self):
        try:
            self.client = vision.ImageAnnotatorClient()
            logger.info("Google Vision Client initialized successfully.")
        except Exception as e:
            logger.error(
                f"Error initializing Google Vision Client: {e}. "
                f"Ensure GOOGLE_APPLICATION_CREDENTIALS_PATH in config.py is correct.",
                exc_info=True,
            )
            self.client = None

    def detect_text_from_image_bytes(self, image_bytes):
        if not self.client:
            logger.error("Google Vision client not initialized. Cannot detect text.")
            return None
        try:
            image = vision.Image(content=image_bytes)
            response = self.client.text_detection(image=image)
            return response.text_annotations
        except Exception as e:
            logger.warning(f"Google Vision text detection failed: {e}", exc_info=True)
            return None