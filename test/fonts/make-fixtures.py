"""Builds the two font fixtures in this folder from their OFL originals.

usage: py -3 test/fonts/make-fixtures.py <LiberationSans-Regular.ttf> <MiriamLibre-Regular.otf>

Each is subset to a few characters with fontTools and renamed: a subset is a
Modified Version under the SIL Open Font License, which may not use the
original's Reserved Font Names. Their copyright notices are kept, in the
fonts and in OFL.txt.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent

FIXTURES = [
    {
        "out": "napkin-test-sans.ttf",
        "family": "Napkin Test Sans",
        "postscript": "NapkinTestSans-Regular",
        "text": "AVTo eé Å&1.",
        "origin": "Liberation Sans 2.1.5",
    },
    {
        "out": "napkin-test-cff.otf",
        "family": "Napkin Test CFF",
        "postscript": "NapkinTestCFF-Regular",
        "text": "Ago& 1.",
        "origin": "Miriam Libre 1.000",
    },
]


def rename(font, fixture):
    """Every name the face shows a person, the new one; the copyright, license and URL records kept."""
    keep = {0, 13, 14}
    name = font["name"]
    name.names = [record for record in name.names if record.nameID in keep]
    full = f"{fixture['family']} Regular"
    for name_id, text in (
        (1, fixture["family"]),
        (2, "Regular"),
        (3, f"{fixture['postscript']};test fixture"),
        (4, full),
        (5, "Version 1.000"),
        (6, fixture["postscript"]),
        (10, f"A subset of {fixture['origin']} for napkin-sketch's tests, renamed as the SIL Open Font License asks of a Modified Version."),
    ):
        name.setName(text, name_id, 3, 1, 0x409)
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = [fixture["postscript"]]
        top = cff.topDictIndex[0]
        top.FamilyName = fixture["family"]
        top.FullName = full
        if hasattr(top, "Weight"):
            top.Weight = "Regular"


def main(sources):
    if len(sources) != 2:
        raise SystemExit(__doc__)
    for fixture, source in zip(FIXTURES, sources):
        font = TTFont(source)
        options = subset.Options()
        options.drop_tables += ["GSUB", "GPOS", "GDEF", "FFTM", "DSIG"]
        options.layout_features = []
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.notdef_outline = True
        # The old `kern` table, which the reader is tested on, kept for the pairs among the glyphs kept.
        options.legacy_kern = True
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(text=fixture["text"])
        subsetter.subset(font)
        rename(font, fixture)
        font.save(HERE / fixture["out"])
        print(f"{fixture['out']}: {len(font.getGlyphOrder())} glyphs, {(HERE / fixture['out']).stat().st_size} bytes")


main(sys.argv[1:])
