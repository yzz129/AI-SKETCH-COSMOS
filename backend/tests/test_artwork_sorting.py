from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import artwork_db


class ArtworkSortingTest(unittest.TestCase):
    def test_level_sort_is_applied_before_pagination(self) -> None:
        with (
            tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temporary,
            patch.object(artwork_db, "DATA_DIR", Path(temporary)),
            patch.object(artwork_db, "DB_PATH", Path(temporary) / "cosmos.db"),
            patch.object(artwork_db, "_SCHEMA_READY", False),
        ):
            levels = {"low": 1, "high": 8, "middle": 4}
            for artwork_id in levels:
                artwork_db.upsert_generated_artwork(
                    artwork_id=artwork_id,
                    source_path=Path(temporary) / f"{artwork_id}.png",
                    source_url=f"/{artwork_id}.png",
                    preview_url=None,
                    splat_url=f"/{artwork_id}.splat",
                    ply_url=None,
                    manifest_url=None,
                    gaussian_count=1,
                )

            artwork_db.update_artwork_evolution([
                {
                    "artworkId": artwork_id,
                    "level": level,
                    "experience": 0,
                    "victories": 0,
                    "defeats": 0,
                    "planetTraps": 0,
                    "revision": 1,
                }
                for artwork_id, level in levels.items()
            ])

            first_page = artwork_db.list_artworks(limit=2, offset=0, sort="level_desc")
            second_page = artwork_db.list_artworks(limit=2, offset=2, sort="level_desc")

            self.assertEqual(
                [record["evolution"]["level"] for record in first_page + second_page],
                [8, 4, 1],
            )


if __name__ == "__main__":
    unittest.main()
