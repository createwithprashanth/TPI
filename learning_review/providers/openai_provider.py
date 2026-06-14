from __future__ import annotations

import json
import os
import time

import requests


class OpenAIProvider:
    name = "openai"

    def review(self, prompt: str, *, model: str = "gpt-4.1") -> dict:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        max_attempts = int(os.getenv("OPENAI_REVIEW_MAX_ATTEMPTS", "4"))
        response = None
        for attempt in range(1, max_attempts + 1):
            response = requests.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "input": prompt,
                    "temperature": 0.1,
                    "text": {"format": {"type": "json_object"}},
                },
                timeout=120,
            )
            if response.status_code not in {429, 500, 502, 503, 504}:
                break
            if attempt == max_attempts:
                break
            retry_after = response.headers.get("Retry-After")
            if retry_after and retry_after.isdigit():
                delay = min(float(retry_after), 60.0)
            else:
                delay = min(2.0**attempt, 30.0)
            print(
                f"OpenAI review retry {attempt}/{max_attempts - 1} "
                f"after HTTP {response.status_code}; waiting {delay:.0f}s"
            )
            time.sleep(delay)
        if response is None:
            raise RuntimeError("OpenAI review request was not sent")
        response.raise_for_status()
        data = response.json()
        text = data.get("output_text", "")
        if not text:
            for item in data.get("output", []):
                for content in item.get("content", []):
                    if content.get("type") in {"output_text", "text"}:
                        text += content.get("text", "")
        return json.loads(text)
