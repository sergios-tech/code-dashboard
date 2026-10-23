"""Parse tmux ANSI captures into a cell grid and write them as SVG.

Standard library only. A grid is a list of rows; a row is a list of
cells; a cell is (char, fg, bg, bold). Colours are '#rrggbb' strings, or
None for the terminal default. A double-width character is followed by
an empty-string cell that holds its second column.
"""
import re
import unicodedata
from collections import Counter
from xml.sax.saxutils import escape

DEFAULT_FG = "#d4d4d4"
DEFAULT_BG = "#000000"

BASE_COLOURS = [
    "#000000", "#cd3131", "#0dbc79", "#e5e510",
    "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
    "#666666", "#f14c4c", "#23d18b", "#f5f543",
    "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5",
]
CUBE_LEVELS = [0, 95, 135, 175, 215, 255]

# Escape sequences: CSI, OSC (BEL or ST terminated), charset and single-key escapes.
TOKEN = re.compile(
    r"\x1b\[([0-?]*)[ -/]*([@-~])"
    r"|\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)"
    r"|\x1b[()*+][0-9A-Za-z]"
    r"|\x1b[=>78DEHMc]"
)


def hex_rgb(colour):
    return tuple(int(colour[i:i + 2], 16) for i in (1, 3, 5))


def rgb_hex(r, g, b):
    return "#%02x%02x%02x" % (r, g, b)


def indexed(n):
    """Colour for a 256-colour palette index."""
    if n < 16:
        return BASE_COLOURS[n]
    if n < 232:
        n -= 16
        return rgb_hex(*(CUBE_LEVELS[(n // d) % 6] for d in (36, 6, 1)))
    grey = 8 + 10 * (n - 232)
    return rgb_hex(grey, grey, grey)


def dimmed(fg, bg):
    """The foreground faded halfway towards the background."""
    mixed = zip(hex_rgb(fg or DEFAULT_FG), hex_rgb(bg or DEFAULT_BG))
    return rgb_hex(*((a + b) // 2 for a, b in mixed))


class Style:
    """Current SGR state while walking a stream."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.fg = self.bg = None
        self.bold = self.dim = self.reverse = False

    def apply(self, params):
        """Apply one SGR parameter list."""
        codes = [int(p) if p.isdigit() else 0 for p in params.split(";")]
        i = 0
        while i < len(codes):
            i += self.apply_code(codes, i)

    def apply_code(self, codes, i):
        """Apply codes[i]; return how many codes it used."""
        code = codes[i]
        if code == 0:
            self.reset()
        elif code == 1:
            self.bold = True
        elif code == 2:
            self.dim = True
        elif code == 22:
            self.bold = self.dim = False
        elif code == 7:
            self.reverse = True
        elif code == 27:
            self.reverse = False
        elif 30 <= code <= 37:
            self.fg = BASE_COLOURS[code - 30]
        elif 90 <= code <= 97:
            self.fg = BASE_COLOURS[code - 90 + 8]
        elif 40 <= code <= 47:
            self.bg = BASE_COLOURS[code - 40]
        elif 100 <= code <= 107:
            self.bg = BASE_COLOURS[code - 100 + 8]
        elif code == 39:
            self.fg = None
        elif code == 49:
            self.bg = None
        elif code in (38, 48):
            return self.extended(codes, i)
        return 1

    def extended(self, codes, i):
        """38/48 followed by ;5;n or ;2;r;g;b."""
        mode = codes[i + 1] if i + 1 < len(codes) else None
        if mode == 5 and i + 2 < len(codes):
            colour, used = indexed(min(codes[i + 2], 255)), 3
        elif mode == 2 and i + 4 < len(codes):
            colour, used = rgb_hex(*(min(c, 255) for c in codes[i + 2:i + 5])), 5
        else:
            return len(codes) - i
        if codes[i] == 38:
            self.fg = colour
        else:
            self.bg = colour
        return used

    def cell(self, char):
        fg, bg = self.fg, self.bg
        if self.reverse:
            fg, bg = bg or DEFAULT_BG, fg or DEFAULT_FG
        if self.dim:
            fg = dimmed(fg, bg)
        return (char, fg, bg, self.bold)


def char_width(char):
    """Terminal columns used by a character: 0, 1 or 2."""
    if unicodedata.category(char) in ("Mn", "Me", "Cf", "Cc"):
        return 0
    return 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1


def parse(text):
    """Turn an ANSI string into a grid of cells."""
    style = Style()
    grid, row = [], []
    pos = 0
    while pos < len(text):
        match = TOKEN.match(text, pos)
        if match:
            if match.group(2) == "m":
                style.apply(match.group(1))
            pos = match.end()
            continue
        char = text[pos]
        pos += 1
        if char == "\n":
            grid.append(row)
            row = []
        elif char == "\x1b":
            continue
        else:
            width = char_width(char)
            if width:
                row.append(style.cell(char))
                row.extend([style.cell("")] * (width - 1))
    if row or not text.endswith("\n"):
        grid.append(row)
    return grid


def width(grid):
    return max((len(row) for row in grid), default=0)


def crop(grid, cols=(None, None), rows=(None, None)):
    """Slice a grid by (start, stop) column and row ranges."""
    return [row[slice(*cols)] for row in grid[slice(*rows)]]


def divider(grid):
    """Column of the dock's vertical bar, or None when there is none."""
    seen = Counter(i for row in grid for i, cell in enumerate(row) if cell[0] == "│")
    if not seen:
        return None
    col, count = seen.most_common(1)[0]
    return col if count * 2 >= len(grid) else None


def runs(row, key):
    """Split a row into (start, cells) runs where key(cell) is constant."""
    out = []
    for i, cell in enumerate(row):
        if out and key(out[-1][1][-1]) == key(cell):
            out[-1][1].append(cell)
        else:
            out.append((i, [cell]))
    return out


def to_svg(grid, *, cell_w=8.4, cell_h=17, font="DejaVu Sans Mono",
           bg=DEFAULT_BG, default_fg=DEFAULT_FG):
    """Render a grid as an SVG document."""
    cols = width(grid)
    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s">'
        % (num(cols * cell_w), num(len(grid) * cell_h)),
        '<rect width="100%%" height="100%%" fill="%s"/>' % bg,
        '<g font-family="%s, monospace" font-size="%s" xml:space="preserve">'
        % (escape(font), num(cell_w / 0.602)),
    ]
    for y, row in enumerate(grid):
        out.extend(row_backgrounds(row, y, cell_w, cell_h))
        out.extend(row_text(row, y, cell_w, cell_h, default_fg))
    out.extend(["</g>", "</svg>"])
    return "\n".join(out) + "\n"


def num(value):
    return ("%.2f" % value).rstrip("0").rstrip(".")


def row_backgrounds(row, y, cell_w, cell_h):
    for start, cells in runs(row, lambda c: c[2]):
        if cells[0][2]:
            yield '<rect x="%s" y="%s" width="%s" height="%s" fill="%s"/>' % (
                num(start * cell_w), num(y * cell_h),
                num(len(cells) * cell_w), num(cell_h), cells[0][2])


def row_text(row, y, cell_w, cell_h, default_fg):
    baseline = y * cell_h + cell_h * 0.78
    for start, cells in runs(row, lambda c: (c[1], c[3])):
        chars = "".join(c[0] for c in cells)
        if not chars.strip():
            continue
        _, fg, _, bold = cells[0]
        yield '<text x="%s" y="%s" fill="%s"%s textLength="%s">%s</text>' % (
            num(start * cell_w), num(baseline), fg or default_fg,
            ' font-weight="bold"' if bold else "",
            num(len(cells) * cell_w), escape(chars, {"'": "&apos;", '"': "&quot;"}))
