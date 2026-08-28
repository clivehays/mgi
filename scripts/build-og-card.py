"""A 1200x630 share card, since the traffic arrives from LinkedIn.

Paper background to match the site, the logo lockup, and the question the
landing page asks. No claims, no numbers.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r'C:\Users\Administrator\mgi-site\images\og-card.png'
LOGO = r'C:\Users\Administrator\mgi-site\images\mgi-logo.png'
FONTS = r'C:\Users\Administrator\mgi-site\assets\fonts'

W, H = 1200, 630
PAPER = (241, 236, 227)
INK = (23, 22, 26)
NAVY = (26, 53, 101)
MUTE = (111, 106, 96)

card = Image.new('RGB', (W, H), PAPER)
d = ImageDraw.Draw(card)

# the same paper grain the site uses, so the card and the page feel like one thing
for y in range(0, H, 3):
    for x in range(0, W, 3):
        d.point((x, y), fill=(PAPER[0] - 2, PAPER[1] - 2, PAPER[2] - 2))


def font(name, size):
    p = os.path.join(FONTS, name)
    return ImageFont.truetype(p, size) if os.path.exists(p) else ImageFont.load_default()


serif = font('source-serif-4-normal-latin.woff2', 54)
mono = font('jetbrains-mono-normal-latin.woff2', 18)

logo = Image.open(LOGO).convert('RGBA')
logo.thumbnail((300, 300), Image.LANCZOS)
card.paste(logo, (78, (H - logo.height) // 2 - 20), logo)

x = 78 + logo.width + 56

try:
    d.text((x, 214), 'THE MANAGER GAP INDEX', font=mono, fill=MUTE)
except Exception:
    pass

lines = ['What state is your', 'team actually in?']
y = 254
for ln in lines:
    d.text((x, y), ln, font=serif, fill=INK)
    y += 66

d.line([(x, y + 26), (x + 120, y + 26)], fill=NAVY, width=3)
try:
    d.text((x, y + 46), 'TWENTY QUESTIONS  \u00b7  FIVE MINUTES', font=mono, fill=MUTE)
except Exception:
    pass

card.save(OUT)
print('%s  %dx%d  %d bytes' % (os.path.basename(OUT), W, H, os.path.getsize(OUT)))
