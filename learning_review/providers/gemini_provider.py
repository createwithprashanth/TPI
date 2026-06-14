from __future__ import annotations

import json
import os
import time

import requests


class GeminiProvider:
    name = "gemini"

    def review(self, prompt: str, *, model: str = "gemini-2.5-flash") -> dict:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        response = None
        for attempt in range(4):
            response = requests.post(
                url,
                headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.1,
                        "responseMimeType": "application/json",
                    },
                },
                timeout=120,
            )
            if response.status_code not in {429, 503}:
                break
            if attempt < 3:
                time.sleep(2 ** attempt * 5)
        assert response is not None
        if response.status_code >= 400:
            raise RuntimeError(
                f"Gemini API error {response.status_code} for model {model}: {response.text[:500]}"
            )
        data = response.json()
        text = ""
        for candidate in data.get("candidates", []):
            for part in candidate.get("content", {}).get("parts", []):
                text += part.get("text", "")
        return json.loads(text)


def list_generate_content_models() -> list[str]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    response = requests.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        headers={"x-goog-api-key": api_key},
        timeout=60,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Gemini models.list error {response.status_code}: {response.text[:500]}")
    models = []
    for item in response.json().get("models", []):
        if "generateContent" in item.get("supportedGenerationMethods", []):
            models.append(str(item.get("name", "")).replace("models/", ""))
    return sorted(model for model in models if model)
