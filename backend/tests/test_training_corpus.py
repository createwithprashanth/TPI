from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_validator():
    path = Path(__file__).resolve().parents[1] / "training" / "scripts" / "validate_training_corpus.py"
    spec = importlib.util.spec_from_file_location("validate_training_corpus", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_training_corpus_is_valid():
    validator = _load_validator()
    result = validator.validate()
    assert result.ok, "\n".join(result.errors)
    assert result.source_count >= 5
    assert result.pack_count >= 3
    assert result.example_count >= 6
