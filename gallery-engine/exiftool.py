import subprocess
import json


def extract_metadata(photo_path: str) -> dict:
    """Extract all metadata from a photo using ExifTool."""
    try:
        result = subprocess.run(
            ["exiftool", "-json", "-a", "-u", "-g1", photo_path],
            capture_output=True,
            text=True,
            check=True,
        )
        output = json.loads(result.stdout)
        if output:
            return output[0]
        return {}
    except FileNotFoundError:
        raise RuntimeError("ExifTool not installed or not in PATH")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Failed to extract metadata: {e.stderr}")
