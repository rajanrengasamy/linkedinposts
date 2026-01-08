/**
 * Image Metadata Stripping Utility
 *
 * Removes EXIF, IPTC, and other metadata from image buffers to prevent
 * AI-generation detection by platforms like LinkedIn.
 *
 * Supports JPEG and PNG formats without external dependencies.
 */

/**
 * Detect image type from buffer magic bytes.
 *
 * @param buffer - Image data buffer
 * @returns 'jpeg' | 'png' | 'unknown'
 */
export function detectImageType(buffer: Buffer): 'jpeg' | 'png' | 'unknown' {
  if (buffer.length < 8) {
    return 'unknown';
  }

  // Check for JPEG signature (FF D8)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'jpeg';
  }

  // Check for PNG signature (89 50 4E 47 0D 0A 1A 0A)
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  return 'unknown';
}

/**
 * Strip metadata from JPEG buffer.
 * Removes APP1-APP15 and COM segments while keeping essential markers.
 *
 * @param buffer - JPEG image buffer
 * @returns Cleaned JPEG buffer
 */
export function stripJpegMetadata(buffer: Buffer): Buffer {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('Not a valid JPEG file');
  }

  const output: number[] = [];

  // Start of Image marker
  output.push(0xff, 0xd8);

  let pos = 2;
  while (pos < buffer.length) {
    if (buffer[pos] !== 0xff) {
      break;
    }

    const marker = buffer[pos + 1];
    pos += 2;

    // End of image
    if (marker === 0xd9) {
      output.push(0xff, 0xd9);
      break;
    }

    // Markers without length (standalone markers)
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      output.push(0xff, marker);
      continue;
    }

    // Read segment length
    if (pos + 2 > buffer.length) {
      break;
    }
    const length = buffer.readUInt16BE(pos);

    // Keep only essential markers, skip metadata markers
    // Essential: SOF (Start of Frame), DHT (Huffman Table), DQT (Quantization Table),
    //           DRI (Restart Interval), SOS (Start of Scan), APP0 (JFIF)
    // Skip: APP1-APP15 (EXIF, XMP, etc.), COM (comments)
    const essentialMarkers = [0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xdb, 0xdd, 0xda, 0xe0];

    if (essentialMarkers.includes(marker)) {
      // Copy marker and entire segment
      output.push(0xff, marker);
      for (let i = 0; i < length; i++) {
        output.push(buffer[pos + i]);
      }
    }

    pos += length;

    // After SOS (Start of Scan), copy all remaining data
    if (marker === 0xda) {
      for (let i = pos; i < buffer.length; i++) {
        output.push(buffer[i]);
      }
      break;
    }
  }

  return Buffer.from(output);
}

/**
 * Strip metadata from PNG buffer.
 * Removes non-essential chunks like tEXt, zTXt, iTXt, tIME.
 *
 * @param buffer - PNG image buffer
 * @returns Cleaned PNG buffer
 */
export function stripPngMetadata(buffer: Buffer): Buffer {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a valid PNG file');
  }

  const output: Buffer[] = [];
  output.push(PNG_SIGNATURE);

  let pos = 8;
  while (pos < buffer.length) {
    if (pos + 8 > buffer.length) {
      break;
    }

    const length = buffer.readUInt32BE(pos);
    const chunkType = buffer.subarray(pos + 4, pos + 8).toString('ascii');

    // Keep only essential chunks
    // Remove metadata chunks: tEXt, zTXt, iTXt, tIME, pHYs, etc.
    const essentialChunks = ['IHDR', 'IDAT', 'PLTE', 'tRNS', 'IEND', 'gAMA', 'cHRM', 'sRGB'];

    if (essentialChunks.includes(chunkType)) {
      // Copy entire chunk (length + type + data + CRC)
      const chunkEnd = pos + 12 + length;
      output.push(buffer.subarray(pos, chunkEnd));
    }

    // Move to next chunk
    pos += 12 + length;

    // Stop after IEND
    if (chunkType === 'IEND') {
      break;
    }
  }

  return Buffer.concat(output);
}

/**
 * Strip metadata from image buffer (auto-detects format).
 *
 * @param buffer - Image buffer (JPEG or PNG)
 * @returns Cleaned image buffer
 * @throws Error if format is unsupported or invalid
 */
export function stripImageMetadata(buffer: Buffer): Buffer {
  const imageType = detectImageType(buffer);

  switch (imageType) {
    case 'jpeg':
      return stripJpegMetadata(buffer);
    case 'png':
      return stripPngMetadata(buffer);
    default:
      throw new Error('Unsupported image format (only JPEG and PNG are supported)');
  }
}
