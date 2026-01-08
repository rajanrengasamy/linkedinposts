#!/usr/bin/env python3
"""
Strip metadata from images to avoid AI-generation detection.

This script removes EXIF, IPTC, and other metadata from images while
preserving the visual content. Useful for removing AI generator signatures.

Works without external dependencies - uses only Python standard library.
"""

import struct
import sys
from pathlib import Path
from typing import Optional, Tuple


def strip_jpeg_metadata(input_path: Path, output_path: Path) -> Tuple[int, int]:
    """
    Strip metadata from JPEG files by removing APP1-APP15 and COM segments.
    Keeps only essential markers: SOF, DHT, DQT, DRI, SOS, APP0 (JFIF).
    """
    with open(input_path, 'rb') as f:
        data = f.read()

    if not data.startswith(b'\xff\xd8'):
        raise ValueError('Not a valid JPEG file')

    output = bytearray(b'\xff\xd8')  # SOI (Start of Image) marker

    pos = 2
    while pos < len(data):
        if data[pos] != 0xff:
            break

        marker = data[pos + 1]
        pos += 2

        # End of image
        if marker == 0xd9:
            output.extend(b'\xff\xd9')
            break

        # Markers without length
        if marker == 0x01 or (0xd0 <= marker <= 0xd7):
            output.extend(bytes([0xff, marker]))
            continue

        # Read segment length
        if pos + 2 > len(data):
            break
        length = struct.unpack('>H', data[pos:pos + 2])[0]

        # Keep essential markers, skip metadata (APP1-APP15, COM)
        # Essential: SOF, DHT, DQT, DRI, SOS, APP0 (JFIF)
        essential_markers = [0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xdb, 0xdd, 0xda, 0xe0]

        if marker in essential_markers:
            # Copy marker and segment
            output.extend(b'\xff' + bytes([marker]))
            output.extend(data[pos:pos + length])

        pos += length

        # After SOS (Start of Scan), copy all remaining image data
        if marker == 0xda:
            output.extend(data[pos:])
            break

    with open(output_path, 'wb') as f:
        f.write(output)

    return len(data), len(output)


def strip_png_metadata(input_path: Path, output_path: Path) -> Tuple[int, int]:
    """
    Strip metadata from PNG files by removing non-essential chunks.
    Keeps only: IHDR, IDAT, PLTE, tRNS, IEND, and basic color chunks.
    """
    with open(input_path, 'rb') as f:
        data = f.read()

    png_sig = b'\x89PNG\r\n\x1a\n'

    if not data.startswith(png_sig):
        raise ValueError('Not a valid PNG file')

    output = bytearray(png_sig)

    pos = 8
    while pos < len(data):
        if pos + 8 > len(data):
            break

        length = struct.unpack('>I', data[pos:pos + 4])[0]
        chunk_type = data[pos + 4:pos + 8]

        # Keep only essential chunks
        # Remove metadata chunks like tEXt, zTXt, iTXt, tIME, etc.
        essential = chunk_type in [
            b'IHDR', b'IDAT', b'PLTE', b'tRNS', b'IEND',
            b'pHYs', b'gAMA', b'cHRM', b'sRGB'
        ]

        if essential:
            # Copy entire chunk (length + type + data + CRC)
            chunk_end = pos + 12 + length
            output.extend(data[pos:chunk_end])

        # Move to next chunk
        pos += 12 + length

        # Stop after IEND
        if chunk_type == b'IEND':
            break

    with open(output_path, 'wb') as f:
        f.write(output)

    return len(data), len(output)


def detect_image_type(file_path: Path) -> str:
    """Detect if file is JPEG or PNG by reading magic bytes."""
    with open(file_path, 'rb') as f:
        header = f.read(8)

    if header.startswith(b'\xff\xd8'):
        return 'jpeg'
    elif header.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    else:
        raise ValueError(f'Unsupported file format (only JPEG and PNG supported)')


def strip_metadata(input_path: str, output_path: Optional[str] = None) -> None:
    """
    Remove all metadata from an image file.

    Args:
        input_path: Path to the input image
        output_path: Path for the output image (if None, adds "_clean" suffix)
    """
    input_file = Path(input_path)

    if not input_file.exists():
        raise FileNotFoundError(f"Image not found: {input_path}")

    # Default output path: add "_clean" suffix
    if output_path is None:
        output_file = input_file.parent / f"{input_file.stem}_clean{input_file.suffix}"
    else:
        output_file = Path(output_path)

    # Detect and process image type
    img_type = detect_image_type(input_file)

    if img_type == 'jpeg':
        original_size, cleaned_size = strip_jpeg_metadata(input_file, output_file)
    elif img_type == 'png':
        original_size, cleaned_size = strip_png_metadata(input_file, output_file)

    saved_bytes = original_size - cleaned_size
    saved_percent = 100 * saved_bytes / original_size if original_size > 0 else 0

    print(f"✓ Metadata stripped successfully")
    print(f"  Input:  {input_file}")
    print(f"  Output: {output_file}")
    print(f"  Type:   {img_type.upper()}")
    print(f"  Original: {original_size:,} bytes")
    print(f"  Cleaned:  {cleaned_size:,} bytes")
    print(f"  Saved:    {saved_bytes:,} bytes ({saved_percent:.1f}%)")


def main():
    if len(sys.argv) < 2:
        print("Usage: python strip_metadata.py <input_image> [output_image]")
        print("\nExample:")
        print("  python strip_metadata.py gemini_image.png")
        print("  python strip_metadata.py gemini_image.png clean_image.png")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        strip_metadata(input_path, output_path)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
