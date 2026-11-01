from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

folder = Path(__file__).resolve().parent.parent / 'public' / 'catalogo'
bold = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 29)
small = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 21)
for path in sorted(folder.glob('*.jpg')):
    if path.stem == 'catalogo':
        continue
    im = Image.open(path).convert('RGB')
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((24, 24, 430, 82), radius=17, fill='#983d51')
    d.text((45, 37), 'PÉTALOS DE EMERGENCIA', font=bold, fill='white')
    d.rounded_rectangle((24, 990, 1056, 1060), radius=17, fill='#273a30')
    d.text((45, 1015), 'PRODUCTO FICTICIO  ·  DEMO HACKATÓN DONWEB 2026', font=small, fill='white')
    im.save(path, quality=84, optimize=True)
    print(path.name, path.stat().st_size)
