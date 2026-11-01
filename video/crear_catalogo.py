from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent / 'public' / 'catalogo'
W,H = 1080,1920
im = Image.new('RGB',(W,H),'#f8f5ef')
d = ImageDraw.Draw(im)
font = Path('C:/Windows/Fonts/arial.ttf')
bold = Path('C:/Windows/Fonts/arialbd.ttf')
serif = Path('C:/Windows/Fonts/georgia.ttf')
f = lambda path,size: ImageFont.truetype(str(path),size)
burgundy = '#963d50'
d.rectangle((0,0,W,185),fill=burgundy)
d.text((52,34),'PÉTALOS DE EMERGENCIA',font=f(bold,27),fill='white')
d.text((52,78),'Un gesto para cada momento.',font=f(serif,48),fill='white')
d.text((52,151),'PRODUCTOS FICTICIOS · DEMO HACKATÓN DONWEB 2026',font=f(bold,20),fill='#ffe1e7')
groups=[('MACANAS',[('perdoncito','Perdoncito',28000),('sillon','Dormí en el Sillón',52000),('rodillas','De Rodillas',98000),('aniversario','Aniversario Salvado',75000)]),('FESTEJOS',[('girasoles','Girasoles',34000),('estacion','Alegría de Estación',42000),('suculenta','Planta que Dura',22000)]),('DESPEDIDAS',[('sobrio','Blanco Sereno',60000),('corona','Corona de Despedida',120000),('cesta','Cesta Recuerdo',45000)])]
y=225
for title, products in groups:
    d.text((52,y),title,font=f(bold,29),fill=burgundy)
    d.line((52,y+39,1028,y+39),fill='#d5c6bd',width=2)
    y+=58
    for start in range(0,len(products),4):
        for col,(key,name,price) in enumerate(products[start:start+4]):
            x=52+col*246
            photo=Image.open(root/f'{key}.jpg').convert('RGB').resize((226,226),Image.Resampling.LANCZOS)
            im.paste(photo,(x,y))
            d.text((x,y+235),name,font=f(bold,19),fill='#29362e')
            d.text((x,y+266),'$ '+f'{price:,}'.replace(',','.'),font=f(bold,21),fill=burgundy)
        y+=312
    y+=30
d.rectangle((0,H-95,W,H),fill='#e7e4da')
d.text((52,H-65),'Un catálogo ficticio, creado para demostrar la experiencia de Flora.',font=f(font,21),fill='#625e58')
d.text((52,H-34),'Hackatón DonWeb · Rosario 2026',font=f(bold,20),fill=burgundy)
im.save(root/'catalogo.jpg',quality=82,optimize=True)
print(root/'catalogo.jpg',(root/'catalogo.jpg').stat().st_size)
