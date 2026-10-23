"""Tests for ansi.py: parsing tmux captures and writing SVG."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ansi  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
HEADER = "\x1b[1;38;2;255;255;255;48;2;138;0;0mSERGIO'S TECH\x1b[0m"


def text(row):
    return "".join(cell[0] for cell in row)


class ParseTest(unittest.TestCase):
    def test_header_keeps_text_and_colour(self):
        row = ansi.parse(HEADER)[0]
        self.assertEqual(text(row), "SERGIO'S TECH")
        for char, fg, bg, bold in row:
            self.assertEqual((fg, bg, bold), ("#ffffff", "#8a0000", True))

    def test_reset_clears_style(self):
        row = ansi.parse("\x1b[1;31ma\x1b[0mb")[0]
        self.assertEqual(row[0], ("a", "#cd3131", None, True))
        self.assertEqual(row[1], ("b", None, None, False))

    def test_basic_and_bright_colours(self):
        row = ansi.parse("\x1b[32;44ma\x1b[92;104mb\x1b[39;49mc")[0]
        self.assertEqual(row[0][1:3], ("#0dbc79", "#2472c8"))
        self.assertEqual(row[1][1:3], ("#23d18b", "#3b8eea"))
        self.assertEqual(row[2][1:3], (None, None))

    def test_indexed_colours(self):
        row = ansi.parse("\x1b[38;5;124;48;5;16ma\x1b[38;5;244mb\x1b[38;5;9mc")[0]
        self.assertEqual(row[0][1:3], ("#af0000", "#000000"))
        self.assertEqual(row[1][1], "#808080")
        self.assertEqual(row[2][1], "#f14c4c")

    def test_dim_fades_the_foreground(self):
        dim = ansi.parse("\x1b[2;38;2;200;200;200ma\x1b[22mb")[0]
        self.assertEqual(dim[0][1], "#646464")
        self.assertEqual(dim[1][1], "#c8c8c8")

    def test_bold_off(self):
        row = ansi.parse("\x1b[1ma\x1b[22mb")[0]
        self.assertEqual([c[3] for c in row], [True, False])

    def test_state_carries_across_lines(self):
        grid = ansi.parse("\x1b[31ma\nb")
        self.assertEqual(grid[1][0][1], "#cd3131")

    def test_other_sequences_are_dropped(self):
        link = "\x1b]8;id=1;https://example.test\x1b\\/rc\x1b]8;;\x1b\\"
        self.assertEqual(text(ansi.parse("a\x1b[2Kb" + link)[0]), "ab/rc")

    def test_wide_character_takes_two_cells(self):
        row = ansi.parse("a界b")[0]
        self.assertEqual([c[0] for c in row], ["a", "界", "", "b"])

    def test_trailing_newline_adds_no_row(self):
        self.assertEqual(len(ansi.parse("a\nb\n")), 2)

    def test_fixture(self):
        with open(os.path.join(HERE, "fixtures", "sample.ansi"), encoding="utf-8") as f:
            grid = ansi.parse(f.read())
        rows = [text(r) for r in grid]
        self.assertIn("SERGIO'S TECH", rows[0])
        self.assertTrue(any("┌ VITALS" in r for r in rows))


class SvgTest(unittest.TestCase):
    def svg(self, source):
        return ansi.to_svg(ansi.parse(source))

    def test_background_and_text_colours(self):
        out = self.svg(HEADER + "\x1b[0m plain")
        self.assertIn('fill="#000000"', out)
        self.assertIn('fill="#8a0000"', out)
        self.assertIn('fill="#ffffff"', out)
        self.assertIn('fill="#d4d4d4"', out)

    def test_text_is_escaped(self):
        out = self.svg(HEADER)
        self.assertIn("SERGIO&apos;S TECH", out)
        self.assertNotIn("<S", out)
        self.assertIn("&lt;&amp;", self.svg("<&"))

    def test_bold_runs(self):
        self.assertIn('font-weight="bold"', self.svg(HEADER))

    def test_box_drawing_survives(self):
        out = self.svg("┌ VITALS ─┐\n│ ▰▰▱ │\n└─────────┘")
        for char in "┌─┐│▰▱└┘":
            self.assertIn(char, out)

    def test_size_follows_the_grid(self):
        out = ansi.to_svg(ansi.parse("abcd\nab"), cell_w=10, cell_h=20)
        self.assertIn('width="40"', out)
        self.assertIn('height="40"', out)


class CropTest(unittest.TestCase):
    GRID = ansi.parse("abcdef\nghijkl\nmnopqr")

    def test_columns_and_rows(self):
        out = ansi.crop(self.GRID, cols=(1, 4), rows=(1, 3))
        self.assertEqual([text(r) for r in out], ["hij", "nop"])

    def test_open_ended_range(self):
        out = ansi.crop(self.GRID, cols=(4, None))
        self.assertEqual([text(r) for r in out], ["ef", "kl", "qr"])

    def test_divider_is_the_shared_bar(self):
        grid = ansi.parse("ab│cd\nab│\nabcde\nab│cd")
        self.assertEqual(ansi.divider(grid), 2)

    def test_no_divider(self):
        self.assertIsNone(ansi.divider(ansi.parse("abc\ndef")))


if __name__ == "__main__":
    unittest.main()
