from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.media import MediaAccessDeniedError, resolve_media_path


class MediaTests(unittest.TestCase):
    def test_allows_file_inside_configured_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            media = root / "frame.jpg"
            media.write_bytes(b"image")

            self.assertEqual(resolve_media_path(str(media), (root,)), media)

    def test_denies_file_outside_configured_root(self):
        with tempfile.TemporaryDirectory() as allowed_dir:
            with tempfile.TemporaryDirectory() as other_dir:
                media = Path(other_dir) / "secret.txt"
                media.write_text("secret", encoding="utf-8")

                with self.assertRaises(MediaAccessDeniedError):
                    resolve_media_path(
                        str(media),
                        (Path(allowed_dir).resolve(),),
                    )


if __name__ == "__main__":
    unittest.main()

