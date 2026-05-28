import unittest
from datetime import date

from ui.validate import BadRequest, safe_choice, safe_date, safe_int, safe_slug


class TestSafeSlug(unittest.TestCase):
    def test_accepts_lowercase_slug(self):
        self.assertEqual(safe_slug("eng-lead"), "eng-lead")

    def test_rejects_dot_dot(self):
        with self.assertRaises(BadRequest):
            safe_slug("..")

    def test_rejects_slash(self):
        with self.assertRaises(BadRequest):
            safe_slug("foo/bar")

    def test_rejects_nul_byte(self):
        with self.assertRaises(BadRequest):
            safe_slug("foo\x00bar")

    def test_rejects_empty(self):
        with self.assertRaises(BadRequest):
            safe_slug("")

    def test_rejects_capitalized(self):
        with self.assertRaises(BadRequest):
            safe_slug("Capitalized")

    def test_rejects_too_long(self):
        with self.assertRaises(BadRequest):
            safe_slug("a" * 65)


class TestSafeInt(unittest.TestCase):
    def test_accepts_valid_int(self):
        self.assertEqual(safe_int("42"), 42)

    def test_rejects_non_integer(self):
        with self.assertRaises(BadRequest):
            safe_int("abc")

    def test_rejects_negative(self):
        with self.assertRaises(BadRequest):
            safe_int("-1")

    def test_rejects_zero_by_default(self):
        with self.assertRaises(BadRequest):
            safe_int("0")

    def test_rejects_over_max(self):
        with self.assertRaises(BadRequest):
            safe_int("10000001")


class TestSafeDate(unittest.TestCase):
    def test_accepts_iso_date(self):
        self.assertEqual(safe_date("2026-05-28"), date(2026, 5, 28))

    def test_rejects_bad_month(self):
        with self.assertRaises(BadRequest):
            safe_date("2026-13-01")

    def test_rejects_garbage(self):
        with self.assertRaises(BadRequest):
            safe_date("not-a-date")

    def test_rejects_empty(self):
        with self.assertRaises(BadRequest):
            safe_date("")


class TestSafeChoice(unittest.TestCase):
    def test_accepts_in_set(self):
        self.assertEqual(safe_choice("success", ("success", "partial", "failure")), "success")

    def test_rejects_not_in_set(self):
        with self.assertRaises(BadRequest):
            safe_choice("BADVALUE", ("success", "partial", "failure"))


if __name__ == "__main__":
    unittest.main()
