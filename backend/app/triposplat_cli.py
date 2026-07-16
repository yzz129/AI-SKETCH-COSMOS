import argparse
import json
from pathlib import Path

from .triposplat_worker import generate_triposplat_assets


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one TripoSplat generation job outside the API process.")
    parser.add_argument("--artwork-id", required=True)
    parser.add_argument("--artwork-dir", required=True)
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--num-gaussians", type=int, required=True)
    parser.add_argument("--format", choices=["splat", "ply", "both"], default="both")
    parser.add_argument("--features-json", default="{}")
    args = parser.parse_args()

    result = generate_triposplat_assets(
        artwork_id=args.artwork_id,
        artwork_dir=Path(args.artwork_dir),
        source_path=Path(args.source_path),
        num_gaussians=args.num_gaussians,
        export_format=args.format,
        features=json.loads(args.features_json),
    )
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
