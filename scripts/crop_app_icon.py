from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Crop a transparent app icon to a centered square without resampling.",
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--alpha-threshold",
        type=int,
        default=2,
        help="Minimum alpha value included in the visible-content bounding box.",
    )
    parser.add_argument(
        "--padding",
        type=int,
        default=32,
        help="Transparent pixels retained around the visible-content bounding box.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = Image.open(args.input).convert("RGBA")
    alpha = source.getchannel("A")
    visible_mask = alpha.point(
        lambda value: 255 if value >= args.alpha_threshold else 0,
    )
    bbox = visible_mask.getbbox()
    if bbox is None:
        raise ValueError("The source image has no visible pixels.")

    left, top, right, bottom = bbox
    content_width = right - left
    content_height = bottom - top
    side = max(content_width, content_height) + args.padding * 2
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    crop_left = round(center_x - side / 2)
    crop_top = round(center_y - side / 2)
    crop_box = (
        crop_left,
        crop_top,
        crop_left + side,
        crop_top + side,
    )

    if (
        crop_box[0] < 0
        or crop_box[1] < 0
        or crop_box[2] > source.width
        or crop_box[3] > source.height
    ):
        raise ValueError(f"Calculated crop {crop_box} exceeds {source.size}.")

    cropped = source.crop(crop_box)
    if cropped.width != cropped.height:
        raise AssertionError("The cropped icon is not square.")
    if cropped.getchannel("A").getextrema()[0] != 0:
        raise AssertionError("The cropped icon no longer has transparent pixels.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(args.output, format="PNG", optimize=True)
    print(
        f"source={source.size} alpha_bbox={bbox} crop={crop_box} "
        f"output={cropped.size}",
    )


if __name__ == "__main__":
    main()
