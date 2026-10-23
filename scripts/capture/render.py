"""Render tmux ANSI captures as SVG, PNG, GIF or a social card.

    python3 render.py frames/*.ansi --png out.png
    python3 render.py frames/*.ansi --gif out.gif
    python3 render.py frames/*.ansi --social out.png

PNG, SVG and social cards use the last frame given; a GIF uses them all.
"""
import argparse
import os
import sys

import ansi

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MAX_GIF_BYTES = 3 * 1024 * 1024
BRAND = "#8a0000"

# Block elements as (x0, y0, x1, y1) fractions of the cell.
QUADRANTS = {
    "▖": "LL", "▗": "LR", "▘": "UL", "▙": "UL LL LR",
    "▚": "UL LR", "▛": "UL UR LL", "▜": "UL UR LR",
    "▝": "UR", "▞": "UR LL", "▟": "UR LL LR",
}
QUADRANT_BOX = {
    "UL": (0, 0, .5, .5), "UR": (.5, 0, 1, .5),
    "LL": (0, .5, .5, 1), "LR": (.5, .5, 1, 1),
}
# Box-drawing characters as the arms (up, down, left, right) that meet at the cell centre.
LINES = {
    "\u2500": "lr", "\u2502": "ud", "\u250c": "dr", "\u2510": "dl", "\u2514": "ur",
    "\u2518": "ul", "\u251c": "udr", "\u2524": "udl", "\u252c": "dlr", "\u2534": "ulr",
    "\u253c": "udlr", "\u256d": "dr", "\u256e": "dl", "\u2570": "ur", "\u256f": "ul",
}
SHADES = {"░": .25, "▒": .5, "▓": .75}


def block_boxes(char):
    """Fractional boxes and opacity for a block-element character, or None."""
    code = ord(char)
    if char == "▀":
        return [(0, 0, 1, .5)], 1
    if 0x2581 <= code <= 0x2587:
        return [(0, 1 - (code - 0x2580) / 8, 1, 1)], 1
    if char == "█":
        return [(0, 0, 1, 1)], 1
    if 0x2589 <= code <= 0x258f:
        return [(0, 0, (0x2590 - code) / 8, 1)], 1
    if char == "▐":
        return [(.5, 0, 1, 1)], 1
    if char in SHADES:
        return [(0, 0, 1, 1)], SHADES[char]
    if char == "▔":
        return [(0, 0, 1, 1 / 8)], 1
    if char == "▕":
        return [(7 / 8, 0, 1, 1)], 1
    if char in QUADRANTS:
        return [QUADRANT_BOX[q] for q in QUADRANTS[char].split()], 1
    return None


def line_boxes(arms, face):
    """Pixel boxes (x0, y0, x1, y1), relative to the cell, for box-drawing arms."""
    t = max(1, round(face.cell_h / 17))
    x0, y0 = face.cell_w // 2 - t // 2, face.cell_h // 2 - t // 2
    x1, y1 = x0 + t, y0 + t
    reach = {"u": (x0, 0, x1, y1), "d": (x0, y0, x1, face.cell_h),
             "l": (0, y0, x1, y1), "r": (x0, y0, face.cell_w, y1)}
    return [reach[a] for a in arms]


def mix(top, bottom, alpha):
    a, b = ansi.hex_rgb(top), ansi.hex_rgb(bottom)
    return ansi.rgb_hex(*(round(x * alpha + y * (1 - alpha)) for x, y in zip(a, b)))


class Face:
    """A regular and bold font plus the cell size they imply."""

    def __init__(self, font_path, size):
        from PIL import ImageFont
        self.regular = ImageFont.truetype(font_path, size)
        bold_path = font_path.replace(".ttf", "-Bold.ttf")
        self.bold = ImageFont.truetype(bold_path if os.path.exists(bold_path) else font_path, size)
        ascent, descent = self.regular.getmetrics()
        self.cell_w = round(self.regular.getlength("M"))
        self.cell_h = ascent + descent


def draw_cell(draw, face, col, row, cell):
    char, fg, bg, bold = cell
    x, y = col * face.cell_w, row * face.cell_h
    if bg:
        draw.rectangle([x, y, x + face.cell_w - 1, y + face.cell_h - 1], fill=bg)
    if not char.strip():
        return
    fg = fg or ansi.DEFAULT_FG
    if char in LINES:
        for x0, y0, x1, y1 in line_boxes(LINES[char], face):
            draw.rectangle([x + x0, y + y0, x + x1 - 1, y + y1 - 1], fill=fg)
        return
    blocks = block_boxes(char)
    if blocks:
        boxes, alpha = blocks
        colour = mix(fg, bg or ansi.DEFAULT_BG, alpha)
        for x0, y0, x1, y1 in boxes:
            draw.rectangle([x + round(x0 * face.cell_w), y + round(y0 * face.cell_h),
                            x + round(x1 * face.cell_w) - 1, y + round(y1 * face.cell_h) - 1],
                           fill=colour)
    else:
        draw.text((x, y), char, font=face.bold if bold else face.regular, fill=fg)


def image(grid, *, font_path=FONT_PATH, size=14, scale=1, cols=0, rows=0):
    """Draw a grid onto a new RGB image, padded to at least cols x rows cells."""
    from PIL import Image, ImageDraw
    face = Face(font_path, size * scale)
    cols, rows = max(cols, ansi.width(grid)), max(rows, len(grid))
    canvas = Image.new("RGB", (cols * face.cell_w, rows * face.cell_h), ansi.DEFAULT_BG)
    draw = ImageDraw.Draw(canvas)
    for row, cells in enumerate(grid):
        for col, cell in enumerate(cells):
            draw_cell(draw, face, col, row, cell)
    return canvas


def png(grid, path, *, font_path=FONT_PATH, size=14, scale=2):
    image(grid, font_path=font_path, size=size, scale=scale).save(path)


def gif(grids, path, *, ms_per_frame=700):
    """Write an animated GIF; fail if it comes out over 3 MB."""
    from PIL import Image
    cols = max(ansi.width(g) for g in grids)
    rows = max(len(g) for g in grids)
    frames = [image(g, cols=cols, rows=rows).quantize(colors=64, dither=Image.Dither.NONE) for g in grids]
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=ms_per_frame, loop=0)
    size = os.path.getsize(path)
    if size > MAX_GIF_BYTES:
        os.remove(path)
        raise ValueError("%s is %d bytes, over the %d byte limit; use fewer or smaller frames"
                         % (path, size, MAX_GIF_BYTES))


def trim_blank_rows(grid):
    """Drop empty rows from the bottom so a short pane fills the card."""
    blank = lambda row: all(not c[0].strip() and not c[2] for c in row)
    end = len(grid)
    while end > 1 and blank(grid[end - 1]):
        end -= 1
    return grid[:end]


def social(grid, path, *, size=(1280, 640), margin=40, bar=24):
    """A 1280x640 card: the pane (trailing blank rows dropped) centred on black above a crimson bar."""
    from PIL import Image, ImageDraw
    shot = image(trim_blank_rows(grid), scale=2)
    room = (size[0] - 2 * margin, size[1] - bar - 2 * margin)
    ratio = min(room[0] / shot.width, room[1] / shot.height)
    shot = shot.resize((round(shot.width * ratio), round(shot.height * ratio)), Image.Resampling.LANCZOS)
    card = Image.new("RGB", size, ansi.DEFAULT_BG)
    card.paste(shot, ((size[0] - shot.width) // 2, (size[1] - bar - shot.height) // 2))
    ImageDraw.Draw(card).rectangle([0, size[1] - bar, size[0], size[1]], fill=BRAND)
    card.save(path)


def span(text):
    """Parse 'A:B' (either side optional) into a slice pair."""
    start, _, stop = text.partition(":")
    return (int(start) if start else None, int(stop) if stop else None)


def load(path):
    with open(path, encoding="utf-8") as f:
        return ansi.parse(f.read())


def crop_all(grids, args):
    cols = span(args.cols) if args.cols else (None, None)
    if args.pane:
        bar = ansi.divider(grids[0])
        if bar is None:
            sys.exit("render.py: no dock divider found; use --cols instead")
        cols = (bar + 1, None)
    rows = span(args.rows) if args.rows else (None, None)
    return [ansi.crop(g, cols, rows) for g in grids]


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("frames", nargs="+", help=".ansi captures from capture.sh")
    p.add_argument("--png", metavar="OUT")
    p.add_argument("--gif", metavar="OUT")
    p.add_argument("--svg", metavar="OUT")
    p.add_argument("--social", metavar="OUT", help="1280x640 card")
    where = p.add_mutually_exclusive_group()
    where.add_argument("--cols", metavar="A:B", help="keep columns A to B (python slice)")
    where.add_argument("--pane", action="store_true", help="keep everything right of the dock divider")
    p.add_argument("--rows", metavar="A:B", help="keep rows A to B (python slice)")
    p.add_argument("--ms", type=int, default=700, help="GIF milliseconds per frame")
    p.add_argument("--font", default=FONT_PATH)
    args = p.parse_args(argv)
    if not (args.png or args.gif or args.svg or args.social):
        p.error("give at least one of --png, --gif, --svg, --social")
    return args


def main(argv=None):
    args = parse_args(argv)
    grids = crop_all([load(f) for f in args.frames], args)
    last = grids[-1]
    if args.svg:
        with open(args.svg, "w", encoding="utf-8") as f:
            f.write(ansi.to_svg(last))
    if args.png:
        png(last, args.png, font_path=args.font)
    if args.social:
        social(last, args.social)
    if args.gif:
        gif(grids, args.gif, ms_per_frame=args.ms)


if __name__ == "__main__":
    main()
