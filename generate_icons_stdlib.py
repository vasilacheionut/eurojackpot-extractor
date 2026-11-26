import struct
import zlib
from pathlib import Path


def make_png(size: int, filename: str) -> None:
    # Culori RGBA
    bg = (15, 23, 42, 255)        # #0f172a
    main_ball = (59, 130, 246, 255)  # #3b82f6
    euro_ball = (234, 179, 8, 255)   # #eab308
    border = (148, 163, 184, 255)

    # Centru și raze relative
    cx1, cy1 = size * 0.44, size * 0.46
    r1 = size * 0.30

    cx2, cy2 = size * 0.68, size * 0.68
    r2 = size * 0.19

    raw_rows = bytearray()
    for y in range(size):
        raw_rows.append(0)  # filter type 0 (None)
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            color = bg

            d1 = ((px - cx1) ** 2 + (py - cy1) ** 2) ** 0.5
            if d1 <= r1:
                color = main_ball if d1 <= r1 - max(2.0, size * 0.015) else border

            d2 = ((px - cx2) ** 2 + (py - cy2) ** 2) ** 0.5
            if d2 <= r2:
                color = euro_ball if d2 <= r2 - max(2.0, size * 0.015) else bg

            raw_rows.extend(color)

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack("!I", len(data)) + tag + data + struct.pack("!I", crc)

    ihdr = struct.pack("!IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw_rows), level=9)

    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )

    Path(filename).write_bytes(png_bytes)
    print(f"Created {filename} ({size}x{size})")


def main() -> None:
    make_png(192, "icon-192.png")
    make_png(512, "icon-512.png")


if __name__ == "__main__":
    main()
