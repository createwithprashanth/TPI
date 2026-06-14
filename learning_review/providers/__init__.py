from __future__ import annotations

from .gemini_provider import GeminiProvider
from .mock import MockProvider
from .openai_provider import OpenAIProvider


def get_provider(name: str):
    normalized = name.strip().lower()
    if normalized == "mock":
        return MockProvider()
    if normalized == "openai":
        return OpenAIProvider()
    if normalized == "gemini":
        return GeminiProvider()
    raise ValueError(f"Unknown teacher provider: {name}")
