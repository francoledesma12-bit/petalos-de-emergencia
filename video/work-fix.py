from pathlib import Path
import re,json,subprocess
p=Path('src/pages/index.astro')
s=p.read_text(encoding='utf-8')
d=[]
for i in range(1,10):
 v=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'audio/escena-{i}.mp3']))
 d.append(round(v+.6,4))
s=re.sub(r'const durations=\[[^\]]+\]', 'const durations='+json.dumps(d),s)
s=s.replace("s.style.setProperty('--local',local);", "s.style.setProperty('--local',local); if(i===index) animateScene(s,local,durations[index]);")
insert='''
  const ease=x=>1-Math.pow(1-Math.max(0,Math.min(1,x)),3);
  function animateScene(s,t,d){
    const nodes=s.querySelectorAll('.eyebrow,h1,p,.pill,.mini-tags,.tone-card,.work-col,.handoff-card,.preview-flow>div,.preview-note,.future-tags,.final-brand,.url,.end-line,.recovery,.price-proof');
    nodes.forEach((n,j)=>{const q=ease((t-.12-j*.12)/.85);n.style.opacity=q;n.style.transform=`translateY(${(1-q)*35}px)`;n.style.filter=`blur(${(1-q)*5}px)`;});
    s.querySelectorAll('.bubble').forEach((n,j)=>{const q=ease((t-.7-j*1.35)/.6);n.style.opacity=q;n.style.transform=`translateY(${(1-q)*24}px) scale(${.95+.05*q})`;});
    s.querySelectorAll('.phone').forEach(n=>n.style.transform=`translateY(${Math.sin(t*.8)*7}px) rotate(${Math.sin(t*.4)*1.4}deg)`);
    s.querySelectorAll('.preview-images img').forEach((n,j)=>{const q=ease((t-1-j*.4)/1);n.style.opacity=q;n.style.transform=`translateY(${(1-q)*70}px) scale(${1+t*.004})`;});
    s.querySelectorAll('.steps span').forEach((n,j)=>{const on=t>1+j*1.3;n.style.background=on?'#24b5b8':'#16394d';n.style.boxShadow=on?'0 0 22px #38e8e64d':'none'});
    s.querySelectorAll('.huge-flower,.end-bloom').forEach(n=>n.style.transform=`rotate(${t*3}deg) scale(${1+Math.sin(t*.4)*.04})`);
    s.querySelectorAll('.audio-wave').forEach(n=>n.style.transform=`scaleY(${.55+Math.abs(Math.sin(t*6))*.45})`);
  }
'''
s=s.replace('  window.renderFrame=frame;',insert+'  window.renderFrame=frame;')
p.write_text(s,encoding='utf-8')
a=Path('montar_audio.py');text=a.read_text(encoding='utf-8');text=re.sub(r'duraciones = \[[^\]]+\]','duraciones = '+json.dumps(d),text);a.write_text(text,encoding='utf-8')
c=Path('capturar.mjs');text=c.read_text(encoding='utf-8');text=re.sub(r'const seconds = [\d.]+;',f'const seconds = {sum(d)};',text);text=text.replace("await rm(framesDir, { recursive: true, force: true });", "// Se conservan capturas anteriores; la numeración nueva reemplaza las necesarias.")
c.write_text(text,encoding='utf-8');Path('duration.txt').write_text(str(sum(d)))
print('Duración real:',sum(d))
