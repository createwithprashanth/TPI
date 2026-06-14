from __future__ import annotations

from typing import Protocol


class TeacherProvider(Protocol):
    name: str

    def review(self, prompt: str, *, model: str) -> dict:
        ...
