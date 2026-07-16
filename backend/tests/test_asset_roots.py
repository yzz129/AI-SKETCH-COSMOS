from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.main import MultiRootStaticFiles
from app.storage import BACKEND_ROOT, OUTPUT_ROOT


class AssetRootTest(unittest.TestCase):
    def test_canonical_output_root_does_not_depend_on_working_directory(self) -> None:
        self.assertEqual(OUTPUT_ROOT, (BACKEND_ROOT / "outputs").resolve())

    def test_static_files_falls_back_to_legacy_output_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            canonical = base / "canonical"
            legacy = base / "legacy"
            canonical.mkdir()
            legacy.mkdir()
            asset = legacy / "artwork_test" / "model.splat"
            asset.parent.mkdir()
            asset.write_bytes(b"splat")

            static_files = MultiRootStaticFiles((canonical, legacy))
            resolved, stat_result = static_files.lookup_path("artwork_test/model.splat")

            self.assertTrue(Path(resolved).samefile(asset))
            self.assertIsNotNone(stat_result)


if __name__ == "__main__":
    unittest.main()
