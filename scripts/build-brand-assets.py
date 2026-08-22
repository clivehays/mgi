"""Cut the mark out of the logo lockup, drop the cream background, and write
the favicon set plus a masthead mark.

The source is a JPEG on cream. Dropping the background to alpha lets the mark
sit on the site's own paper colour instead of showing a lighter box, and lets
the favicon work on any browser chrome.
"""
import os
from PIL import Image

SRC = r'C:\Users\Administrator\Downloads\Gemini_Generated_Image_hejyx2hejyx2hejy.jpg'
OUT = r'C:\Users\Administrator\mgi-site\images'

im = Image.open(SRC).convert('RGB')
W, H = im.size
px = im.load()

PAPER = (254, 249, 245)


def ink(c):
    return max(abs(c[0] - PAPER[0]), abs(c[1] - PAPER[1]), abs(c[2] - PAPER[2]))


# ink density per row, to find where the mark ends and the wordmark begins
rows = []
for y in range(H):
    n = 0
    for x in range(0, W, 6):
        if ink(px[x, y]) > 70:
            n += 1
    rows.append(n)

first = next(y for y, n in enumerate(rows) if n > 2)
last = H - 1 - next(i for i, n in enumerate(reversed(rows)) if n > 2)

# the widest empty band between them separates mark from wordmark
best_gap, gap_start, run_start = 0, None, None
for y in range(first, last + 1):
    if rows[y] <= 1:
        if run_start is None:
            run_start = y
    else:
        if run_start is not None:
            if y - run_start > best_gap:
                best_gap, gap_start = y - run_start, run_start
            run_start = None

mark_bottom = gap_start if gap_start else last
print('content rows %d..%d, mark ends at %d (gap of %d rows)' % (first, last, mark_bottom, best_gap))

# horizontal extent of the mark only
cols = []
for x in range(W):
    n = 0
    for y in range(first, mark_bottom, 6):
        if ink(px[x, y]) > 70:
            n += 1
    cols.append(n)
left = next(x for x, n in enumerate(cols) if n > 1)
right = W - 1 - next(i for i, n in enumerate(reversed(cols)) if n > 1)

pad = 12
box = (max(0, left - pad), max(0, first - pad), min(W, right + pad), min(H, mark_bottom + pad))
mark = im.crop(box)
print('mark cropped to %dx%d' % mark.size)


def to_transparent(img):
    """Soft alpha from distance to the paper colour, so JPEG edges do not halo."""
    img = img.convert('RGBA')
    p = img.load()
    lo, hi = 12, 44
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, _ = p[x, y]
            d = ink((r, g, b))
            if d <= lo:
                a = 0
            elif d >= hi:
                a = 255
            else:
                a = int((d - lo) / (hi - lo) * 255)
            p[x, y] = (r, g, b, a)
    return img


mark_rgba = to_transparent(mark)

os.makedirs(OUT, exist_ok=True)


def save(img, size, name):
    out = img.resize((size, size), Image.LANCZOS)
    out.save(os.path.join(OUT, name))
    print('  %-28s %dx%d  %d bytes' % (name, size, size, os.path.getsize(os.path.join(OUT, name))))


# square canvas so the mark is not distorted
side = max(mark_rgba.size)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(mark_rgba, ((side - mark_rgba.width) // 2, (side - mark_rgba.height) // 2), mark_rgba)

print('\nwriting:')
save(square, 512, 'mgi-mark.png')
save(square, 180, 'apple-touch-icon.png')
save(square, 32, 'favicon-32x32.png')
save(square, 16, 'favicon-16x16.png')

ico = os.path.join(OUT, 'favicon.ico')
square.resize((64, 64), Image.LANCZOS).save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
print('  %-28s multi-size  %d bytes' % ('favicon.ico', os.path.getsize(ico)))

# the full lockup, transparent, for anywhere the wordmark is wanted
lock_box = (0, max(0, first - pad), W, min(H, last + pad))
lock = to_transparent(im.crop(lock_box))
lb = lock.getbbox()
lock = lock.crop(lb)
lock.thumbnail((900, 900), Image.LANCZOS)
lock.save(os.path.join(OUT, 'mgi-logo.png'))
print('  %-28s %dx%d  %d bytes' % ('mgi-logo.png', lock.width, lock.height,
                                   os.path.getsize(os.path.join(OUT, 'mgi-logo.png'))))
