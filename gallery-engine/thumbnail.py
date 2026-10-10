from pathlib import Path

import pyvips


def generate_thumbnail(
    input_path: str,
    output_path: str,
    max_size: int = 500,
) -> dict:
    input_file = Path(input_path)
    output_file = Path(output_path)

    if not input_file.exists():
        raise FileNotFoundError(
            f"Input file not found: {input_path}"
        )

    output_file.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    image = pyvips.Image.thumbnail(
        str(input_file),
        max_size,
        height=max_size,
        size="both",
        crop="none",
    )

    image.write_to_file(
        str(output_file),
        Q=85,
    )

    return {
        "input": str(input_file),
        "output": str(output_file),
        "width": image.width,
        "height": image.height,
    }