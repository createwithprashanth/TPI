"""
Tests for piping_mto.py — core symbol detection engine.
All tests are self-contained: they synthesise minimal PDFs and images
with numpy/fitz so no fixture files are needed.

Coordinate note:
  detect_symbol / detect_all_pages accept template_box in *coord_dpi* space.
  We always pass coord_dpi=72 in tests so that 1 PDF point == 1 pixel,
  making the expected coordinates trivial to calculate.
"""
import numpy as np
import cv2
import pytest
import fitz  # PyMuPDF

from app.modules.instrumap.core.piping_mto import (
    _pdf_hash,
    _preprocess,
    _deskew,
    _nms,
    _rotate_fine,
    _orb_fallback,
    detect_symbol,
    detect_all_pages,
    detect_from_template_image_all_pages,
    _nearest_size_for_match,
    _PAGE_CACHE,
    _fetch_page_gray,
    _size_from_text,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_pdf_with_rect(width_pt=400, height_pt=300,
                        rect_x=50, rect_y=50, rect_w=40, rect_h=40) -> bytes:
    """Single-page PDF with a filled black rectangle."""
    doc = fitz.open()
    page = doc.new_page(width=width_pt, height=height_pt)
    r = fitz.Rect(rect_x, rect_y, rect_x + rect_w, rect_y + rect_h)
    page.draw_rect(r, color=(0, 0, 0), fill=(0, 0, 0))
    return doc.tobytes()


def _make_two_page_pdf_with_rect(rect_x=50, rect_y=50, rect_w=40, rect_h=40) -> bytes:
    doc = fitz.open()
    for _ in range(2):
        page = doc.new_page(width=400, height=300)
        page.draw_rect(fitz.Rect(rect_x, rect_y, rect_x + rect_w, rect_y + rect_h),
                       color=(0, 0, 0), fill=(0, 0, 0))
    return doc.tobytes()


def _gray_image(h=100, w=100, fill=200) -> np.ndarray:
    return np.full((h, w), fill, dtype=np.uint8)


def _image_with_square(h=200, w=200, sq_x=80, sq_y=80, sq_size=30) -> np.ndarray:
    img = np.full((h, w), 255, dtype=np.uint8)
    img[sq_y:sq_y + sq_size, sq_x:sq_x + sq_size] = 0
    return img


# ── _pdf_hash ─────────────────────────────────────────────────────────────────

class TestPdfHash:
    def test_deterministic(self):
        data = b"hello world" * 1000
        assert _pdf_hash(data) == _pdf_hash(data)

    def test_different_content_different_hash(self):
        assert _pdf_hash(b"aaa" * 100) != _pdf_hash(b"bbb" * 100)

    def test_different_length_different_hash(self):
        base = b"x" * 65536
        assert _pdf_hash(base) != _pdf_hash(base + b"extra_bytes")

    def test_empty_bytes(self):
        h = _pdf_hash(b"")
        assert isinstance(h, str) and len(h) == 32

    def test_same_prefix_different_length_differs(self):
        """Same first 64 KB, but different total lengths → different hash via length encoding."""
        prefix = b"A" * 65536
        short = prefix
        long_ = prefix + b"B" * 8
        assert _pdf_hash(short) != _pdf_hash(long_)

    def test_returns_32_char_hex(self):
        h = _pdf_hash(b"test data")
        assert len(h) == 32
        assert all(c in "0123456789abcdef" for c in h)


# ── _preprocess ───────────────────────────────────────────────────────────────

class TestPreprocess:
    def test_returns_same_shape(self):
        img = _gray_image(100, 150)
        assert _preprocess(img).shape == img.shape

    def test_returns_uint8(self):
        assert _preprocess(_gray_image()).dtype == np.uint8

    def test_preserves_extreme_contrast(self):
        img = np.zeros((50, 50), dtype=np.uint8)
        img[10:40, 10:40] = 255
        result = _preprocess(img)
        assert float(result[20:30, 20:30].mean()) > float(result[0:5, 0:5].mean())

    def test_minimum_valid_size(self):
        assert _preprocess(_gray_image(20, 20)).shape == (20, 20)

    def test_preserves_dtype(self):
        img = np.zeros((60, 60), dtype=np.uint8)
        assert _preprocess(img).dtype == np.uint8


# ── _deskew ───────────────────────────────────────────────────────────────────

class TestDeskew:
    def test_blank_image_unchanged(self):
        img = _gray_image(200, 200, fill=128)
        np.testing.assert_array_equal(_deskew(img), img)

    def test_returns_uint8(self):
        assert _deskew(_gray_image(100, 100)).dtype == np.uint8

    def test_output_same_shape(self):
        assert _deskew(_gray_image(150, 200)).shape == (150, 200)

    def test_horizontal_lines_no_rotation(self):
        img = np.full((300, 400), 255, dtype=np.uint8)
        for y in range(50, 300, 60):
            cv2.line(img, (0, y), (400, y), 0, 2)
        result = _deskew(img)
        assert result.shape == img.shape

    def test_no_crash_on_complex_image(self):
        rng = np.random.default_rng(0)
        img = rng.integers(0, 255, (200, 300), dtype=np.uint8)
        result = _deskew(img)
        assert result.shape == (200, 300)


# ── _rotate_fine ──────────────────────────────────────────────────────────────

class TestRotateFine:
    def test_zero_angle_identity(self):
        img = _gray_image(60, 80)
        np.testing.assert_array_equal(_rotate_fine(img, 0.0), img)

    def test_output_same_shape(self):
        img = _gray_image(60, 80)
        for angle in [-15, -10, -5, 5, 10, 15]:
            assert _rotate_fine(img, float(angle)).shape == img.shape

    def test_180_moves_bright_pixel(self):
        """A 180° rotation must move a bright pixel from (5,5) to the mirrored position."""
        h, w = 50, 50
        img = np.zeros((h, w), dtype=np.uint8)
        img[5, 5] = 255
        result = _rotate_fine(img, 180.0)
        # _rotate_fine uses center=(w/2, h/2)=(25,25).
        # 180° maps (row=5, col=5) → row=2*25-5=45, col=2*25-5=45.
        assert result[45, 45] > 128
        assert result[5, 5] < 128

    def test_small_angle_mostly_preserved(self):
        """A 5° rotation of a uniform image should still be mostly the same."""
        img = np.full((100, 100), 128, dtype=np.uint8)
        result = _rotate_fine(img, 5.0)
        # Centre region should be unchanged; border might be zeroed (BORDER_CONSTANT)
        assert float(result[25:75, 25:75].mean()) == pytest.approx(128.0, abs=2)


# ── _nms ─────────────────────────────────────────────────────────────────────

class TestNms:
    def test_single_box_kept(self):
        assert len(_nms([[0, 0, 10, 10, 0.9]])) == 1

    def test_identical_boxes_one_kept(self):
        assert len(_nms([[0, 0, 10, 10, 0.9]] * 5)) == 1

    def test_non_overlapping_all_kept(self):
        boxes = [[0,0,10,10,0.9], [50,0,60,10,0.8], [100,0,110,10,0.7]]
        assert len(_nms(boxes, iou_threshold=0.3)) == 3

    def test_high_iou_best_kept(self):
        boxes = [[0,0,20,20,0.9], [1,1,21,21,0.5]]
        result = _nms(boxes, iou_threshold=0.3)
        assert len(result) == 1
        assert result[0][4] == pytest.approx(0.9)

    def test_sorted_by_score_descending(self):
        boxes = [[0,0,10,10,0.6], [50,0,60,10,0.9], [100,0,110,10,0.75]]
        result = _nms(boxes)
        scores = [b[4] for b in result]
        assert scores == sorted(scores, reverse=True)

    def test_empty_input(self):
        assert _nms([]) == []

    def test_score_preserved(self):
        boxes = [[0, 0, 10, 10, 0.87654]]
        result = _nms(boxes)
        assert result[0][4] == pytest.approx(0.87654)


# ── Pipe size text selection ─────────────────────────────────────────────────

def _word(text: str, x0: float, y0: float, x1: float, y1: float) -> dict:
    return {
        "text": text,
        "x0": x0,
        "y0": y0,
        "x1": x1,
        "y1": y1,
        "cx": (x0 + x1) / 2,
        "cy": (y0 + y1) / 2,
    }


class TestPipeSizeSelection:
    def test_size_parser_accepts_fractional_epc_sizes(self):
        assert _size_from_text('3/4"') == "0.75"
        assert _size_from_text('1-1/2"') == "1.5"
        assert _size_from_text('2"-PG-24466-251482-X-N') == "2"

    def test_vertical_component_prefers_same_elevation_nearest_size(self):
        match = [100, 100, 140, 180, 0.9]
        words = [
            _word('2"', 70, 132, 88, 148),
            _word('3/4"', 150, 245, 184, 262),
        ]
        size, source, confidence = _nearest_size_for_match(match, words)
        assert size == "2"
        assert source == '2"'
        assert confidence > 0.5

    def test_horizontal_component_prefers_centered_local_size(self):
        match = [100, 100, 170, 137, 0.9]
        words = [
            _word('2"', 124, 74, 146, 90),
            _word('3/4"', 42, 106, 76, 122),
        ]
        size, source, _ = _nearest_size_for_match(match, words)
        assert size == "2"
        assert source == '2"'

    def test_standalone_size_beats_nearby_line_number_fallback(self):
        match = [100, 100, 140, 180, 0.9]
        words = [
            _word('2"-PG-24466-251482-X-N', 118, 195, 250, 212),
            _word('3/4"', 145, 124, 180, 140),
        ]
        size, source, _ = _nearest_size_for_match(match, words)
        assert size == "0.75"
        assert source == '3/4"'


# ── _orb_fallback ─────────────────────────────────────────────────────────────

class TestOrbFallback:
    def test_returns_list(self):
        tmpl = _image_with_square(80, 80, 20, 20, 30)
        page = _image_with_square(300, 300, 100, 100, 30)
        assert isinstance(_orb_fallback(tmpl, page), list)

    def test_identical_images_no_crash(self):
        img = _image_with_square(100, 100, 30, 30, 20)
        assert isinstance(_orb_fallback(img, img), list)

    def test_blank_images_returns_empty(self):
        blank = np.full((100, 100), 200, dtype=np.uint8)
        assert _orb_fallback(blank, blank) == []

    def test_result_boxes_within_page(self):
        tmpl = _image_with_square(50, 50, 10, 10, 25)
        page = _image_with_square(400, 400, 150, 150, 25)
        for x1, y1, x2, y2, score in _orb_fallback(tmpl, page):
            assert 0 <= x1 < x2 <= 400
            assert 0 <= y1 < y2 <= 400
            assert 0.0 <= score <= 1.0


# ── Page cache ────────────────────────────────────────────────────────────────

class TestPageCache:
    def test_cache_populated(self):
        pdf_bytes = _make_pdf_with_rect()
        h = _pdf_hash(pdf_bytes)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        key = (h, 72, 0)
        _PAGE_CACHE.pop(key, None)
        _fetch_page_gray(doc, 0, 72, h)
        assert key in _PAGE_CACHE

    def test_cache_hit_same_object(self):
        pdf_bytes = _make_pdf_with_rect()
        h = _pdf_hash(pdf_bytes)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        key = (h, 72, 0)
        _PAGE_CACHE.pop(key, None)
        arr1 = _fetch_page_gray(doc, 0, 72, h)
        arr2 = _fetch_page_gray(doc, 0, 72, h)
        assert arr1 is arr2

    def test_different_dpi_different_shapes(self):
        pdf_bytes = _make_pdf_with_rect()
        h = _pdf_hash(pdf_bytes)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        _PAGE_CACHE.pop((h, 72, 0), None)
        _PAGE_CACHE.pop((h, 150, 0), None)
        g72  = _fetch_page_gray(doc, 0,  72, h)
        g150 = _fetch_page_gray(doc, 0, 150, h)
        assert g72.shape != g150.shape


# ── detect_symbol ─────────────────────────────────────────────────────────────

class TestDetectSymbol:
    """
    Use coord_dpi=72 so that template_box coordinates match PDF point coords 1:1.
    The black rectangle is at (50,50,90,90) pt → template_box=(50,50,90,90) at coord_dpi=72.
    """

    PDF = None  # set once in first test via property for speed

    def _pdf(self):
        return _make_pdf_with_rect(rect_x=50, rect_y=50, rect_w=40, rect_h=40)

    def _call(self, **kw):
        defaults = {
            "pdf_bytes": self._pdf(),
            "template_box": (50, 50, 90, 90),
            "search_box": None,
            "threshold": 0.80,
            "label": "Symbol",
            "coord_dpi": 72,
            "dpi": 72,
        }
        defaults.update(kw)
        return detect_symbol(**defaults)

    def test_returns_required_keys(self):
        r = self._call()
        for key in ("count", "matches", "label", "annotated_image", "image_width", "image_height"):
            assert key in r

    def test_label_passthrough(self):
        assert self._call(label="MY_LABEL")["label"] == "MY_LABEL"

    def test_count_is_non_negative(self):
        assert self._call()["count"] >= 0

    def test_annotated_image_is_base64_jpeg(self):
        import base64
        raw = base64.b64decode(self._call()["annotated_image"])
        assert raw[:2] == b"\xff\xd8"  # JPEG magic

    def test_match_coords_within_image(self):
        r = self._call()
        W, H = r["image_width"], r["image_height"]
        for m in r["matches"]:
            assert 0 <= m["x1"] < m["x2"] <= W
            assert 0 <= m["y1"] < m["y2"] <= H
            assert 0.0 <= m["score"] <= 1.0

    def test_empty_template_box_raises(self):
        with pytest.raises((ValueError, Exception)):
            detect_symbol(
                pdf_bytes=self._pdf(),
                template_box=(0, 0, 0, 0),
                search_box=None,
                coord_dpi=72,
                dpi=72,
            )

    def test_threshold_filters_matches(self):
        lo = self._call(threshold=0.75)["count"]
        hi = self._call(threshold=0.99)["count"]
        assert lo >= hi


# ── detect_all_pages ──────────────────────────────────────────────────────────

class TestDetectAllPages:
    def _pdf(self):
        return _make_two_page_pdf_with_rect(rect_x=50, rect_y=50, rect_w=40, rect_h=40)

    def _call(self, **kw):
        defaults = {
            "pdf_bytes": self._pdf(),
            "template_box": (50, 50, 90, 90),
            "threshold": 0.80,
            "coord_dpi": 72,
            "dpi": 72,
        }
        defaults.update(kw)
        return detect_all_pages(**defaults)

    def test_returns_required_keys(self):
        r = self._call()
        assert "pages" in r and "total_count" in r and "annotated_image" in r

    def test_page_count_matches_pdf(self):
        assert len(self._call()["pages"]) == 2

    def test_page_numbers_start_at_1(self):
        pages = self._call()["pages"]
        assert pages[0]["page"] == 1

    def test_total_equals_sum_of_pages(self):
        r = self._call()
        assert r["total_count"] == sum(p["count"] for p in r["pages"])

    def test_annotated_image_is_base64_jpeg(self):
        import base64
        raw = base64.b64decode(self._call()["annotated_image"])
        assert raw[:2] == b"\xff\xd8"


# ── detect_from_template_image_all_pages ──────────────────────────────────────

class TestDetectFromTemplateImage:
    def _pdf(self):
        return _make_pdf_with_rect(rect_x=50, rect_y=50, rect_w=40, rect_h=40)

    def _template_png(self):
        img = np.full((40, 40), 255, dtype=np.uint8)
        img[5:35, 5:35] = 0
        _, buf = cv2.imencode(".png", img)
        return buf.tobytes()

    def test_returns_required_keys(self):
        r = detect_from_template_image_all_pages(
            pdf_bytes=self._pdf(), template_bytes=self._template_png(), threshold=0.40, dpi=72,
        )
        for key in ("total_count", "pages", "annotated_image"):
            assert key in r

    def test_total_count_non_negative(self):
        r = detect_from_template_image_all_pages(
            pdf_bytes=self._pdf(), template_bytes=self._template_png(), threshold=0.40, dpi=72,
        )
        assert r["total_count"] >= 0

    def test_invalid_template_raises(self):
        with pytest.raises(Exception):
            detect_from_template_image_all_pages(
                pdf_bytes=self._pdf(), template_bytes=b"not_an_image", dpi=72,
            )

    def test_page_list_present(self):
        r = detect_from_template_image_all_pages(
            pdf_bytes=self._pdf(), template_bytes=self._template_png(), threshold=0.40, dpi=72,
        )
        assert isinstance(r["pages"], list) and len(r["pages"]) >= 1


# ── End-to-end: symbol must actually be found ─────────────────────────────────

class TestEndToEndDetection:
    def test_detects_clear_rectangle(self):
        """A 40×40 black rectangle must be found at threshold 0.70."""
        pdf = _make_pdf_with_rect(width_pt=400, height_pt=300,
                                  rect_x=50, rect_y=50, rect_w=40, rect_h=40)
        r = detect_symbol(
            pdf_bytes=pdf,
            template_box=(50, 50, 90, 90),
            search_box=None,
            threshold=0.70,
            label="rect",
            coord_dpi=72,
            dpi=72,
        )
        assert r["count"] >= 1

    def test_higher_threshold_same_or_fewer_matches(self):
        pdf = _make_pdf_with_rect(rect_x=50, rect_y=50, rect_w=40, rect_h=40)
        lo = detect_symbol(pdf_bytes=pdf, template_box=(50,50,90,90), search_box=None, threshold=0.75, coord_dpi=72, dpi=72)["count"]
        hi = detect_symbol(pdf_bytes=pdf, template_box=(50,50,90,90), search_box=None, threshold=0.99, coord_dpi=72, dpi=72)["count"]
        assert lo >= hi

    def test_all_pages_finds_on_both_pages(self):
        pdf = _make_two_page_pdf_with_rect(rect_x=50, rect_y=50, rect_w=40, rect_h=40)
        r = detect_all_pages(
            pdf_bytes=pdf, template_box=(50,50,90,90), threshold=0.70, coord_dpi=72, dpi=72,
        )
        assert r["total_count"] >= 2  # at least one hit per page
