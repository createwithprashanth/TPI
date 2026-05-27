"""
Tests for app/modules/llm/service.py

All network calls are mocked — no real Ollama needed.
"""
import json
import unittest
from unittest.mock import MagicMock, patch


class TestIsAvailable:

    def test_returns_true_when_model_listed(self):
        from app.modules.llm.service import _is_available
        payload = json.dumps({"models": [{"name": "qwen2.5:7b"}]}).encode()
        mock_resp = MagicMock()
        mock_resp.read.return_value = payload
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("app.modules.llm.service.urllib.request.urlopen", return_value=mock_resp):
            assert _is_available("qwen2.5:7b") is True

    def test_returns_true_on_prefix_match(self):
        from app.modules.llm.service import _is_available
        payload = json.dumps({"models": [{"name": "qwen2.5:7b-instruct-q4_K_M"}]}).encode()
        mock_resp = MagicMock()
        mock_resp.read.return_value = payload
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("app.modules.llm.service.urllib.request.urlopen", return_value=mock_resp):
            assert _is_available("qwen2.5:7b") is True

    def test_returns_false_when_model_absent(self):
        from app.modules.llm.service import _is_available
        payload = json.dumps({"models": [{"name": "llama3:8b"}]}).encode()
        mock_resp = MagicMock()
        mock_resp.read.return_value = payload
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("app.modules.llm.service.urllib.request.urlopen", return_value=mock_resp):
            assert _is_available("qwen2.5:7b") is False

    def test_returns_false_on_connection_error(self):
        import urllib.error
        from app.modules.llm.service import _is_available
        with patch("app.modules.llm.service.urllib.request.urlopen",
                   side_effect=urllib.error.URLError("refused")):
            assert _is_available() is False

    def test_returns_false_on_empty_models(self):
        from app.modules.llm.service import _is_available
        payload = json.dumps({"models": []}).encode()
        mock_resp = MagicMock()
        mock_resp.read.return_value = payload
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("app.modules.llm.service.urllib.request.urlopen", return_value=mock_resp):
            assert _is_available() is False


class TestGenerate:

    def _mock_response(self, inner: dict):
        outer = json.dumps({"response": json.dumps(inner)}).encode()
        mock_resp = MagicMock()
        mock_resp.read.return_value = outer
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    def test_returns_parsed_json(self):
        from app.modules.llm.service import generate
        expected = {"line_number": "6\"-P-1001", "confidence": 0.9, "reason": "closest"}
        with patch("app.modules.llm.service.urllib.request.urlopen",
                   return_value=self._mock_response(expected)):
            result = generate("test prompt")
        assert result == expected

    def test_returns_none_on_url_error(self):
        import urllib.error
        from app.modules.llm.service import generate
        with patch("app.modules.llm.service.urllib.request.urlopen",
                   side_effect=urllib.error.URLError("refused")):
            assert generate("test") is None

    def test_returns_none_on_invalid_json_response(self):
        from app.modules.llm.service import generate
        outer = json.dumps({"response": "not json at all {{{}"}).encode()
        mock_resp = MagicMock()
        mock_resp.read.return_value = outer
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        with patch("app.modules.llm.service.urllib.request.urlopen", return_value=mock_resp):
            assert generate("test") is None

    def test_includes_system_prompt_in_payload(self):
        from app.modules.llm.service import generate
        captured = {}
        def fake_urlopen(req, timeout):
            captured["body"] = json.loads(req.data)
            return self._mock_response({})
        with patch("app.modules.llm.service.urllib.request.urlopen", side_effect=fake_urlopen):
            generate("my prompt", system="be an engineer")
        assert captured["body"]["system"] == "be an engineer"
        assert captured["body"]["format"] == "json"
        assert captured["body"]["options"]["temperature"] == 0.1

    def test_uses_ollama_host_env(self, monkeypatch):
        from importlib import reload
        import app.modules.llm.service as svc
        monkeypatch.setenv("OLLAMA_HOST", "http://ollama:11434")
        reload(svc)
        assert svc.OLLAMA_BASE_URL == "http://ollama:11434"
        monkeypatch.delenv("OLLAMA_HOST", raising=False)
        reload(svc)
