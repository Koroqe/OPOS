import contextlib
import http.client
import io
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

from ui import console, handlers

PAYLOAD = "<script>alert(1)</script>"
ENCODED = "%3Cscript%3Ealert(1)%3C/script%3E"


class ConsoleTestCase(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), console.ConsoleHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop)

    def _stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def get(self, target):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=10)
        try:
            conn.request("GET", target)
            resp = conn.getresponse()
            return resp.status, resp, resp.read().decode("utf-8", "replace")
        finally:
            conn.close()

    def assert_hardened(self, resp):
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")
        self.assertEqual(resp.getheader("X-Content-Type-Options"), "nosniff")


class TestBadRequest(ConsoleTestCase):
    def test_400_is_plain_text_and_does_not_reflect_query(self):
        status, resp, body = self.get(f"/activity?since={ENCODED}")
        self.assertEqual(status, 400)
        self.assertTrue(resp.getheader("Content-Type").startswith("text/plain"))
        self.assertNotIn(PAYLOAD, body)
        self.assertNotIn("script", body)
        self.assertNotIn("<", body)


class TestUnhandledError(ConsoleTestCase):
    def test_500_is_plain_text_and_cause_is_logged_via_repr(self):
        def boom(req):
            raise RuntimeError(PAYLOAD + "\x1b[31m")

        log = io.StringIO()
        routes = [(r"^/boom$", boom)] + list(handlers.ROUTES)
        with mock.patch.object(handlers, "ROUTES", routes), contextlib.redirect_stderr(log):
            status, resp, body = self.get("/boom")
        self.assertEqual(status, 500)
        self.assertTrue(resp.getheader("Content-Type").startswith("text/plain"))
        self.assertNotIn("script", body)
        self.assertNotIn("RuntimeError", body)
        self.assertIn("unhandled RuntimeError: " + repr(PAYLOAD + "\x1b[31m"), log.getvalue())
        self.assertNotIn("\x1b", log.getvalue())


class TestResponseHeaders(ConsoleTestCase):
    def test_every_response_has_no_store_and_nosniff(self):
        def boom(req):
            raise RuntimeError("x")

        routes = [(r"^/boom$", boom)] + list(handlers.ROUTES)
        cases = [
            ("/", 200),
            (f"/activity?since={ENCODED}", 400),
            ("/no-such-page", 404),
            ("/boom", 500),
        ]
        with mock.patch.object(handlers, "ROUTES", routes), contextlib.redirect_stderr(io.StringIO()):
            for target, expected in cases:
                with self.subTest(target=target):
                    status, resp, _ = self.get(target)
                    self.assertEqual(status, expected)
                    self.assert_hardened(resp)


if __name__ == "__main__":
    unittest.main()
