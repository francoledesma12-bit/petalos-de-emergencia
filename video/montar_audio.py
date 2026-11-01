from pathlib import Path
import subprocess

duraciones = [12.4886, 9.0521, 12.0707, 12.9066, 10.0737, 9.7951, 11.4205, 10.4453, 16.6682]
archivos = [Path('audio') / f'escena-{i}.mp3' for i in range(1, 10)]
for archivo in archivos:
    if not archivo.exists():
        raise SystemExit(f'Falta {archivo}')

filtros = []
for i, duracion in enumerate(duraciones):
    filtros.append(f'[{i}:a]aresample=48000,apad=whole_dur={duracion},atrim=duration={duracion},asetpts=PTS-STARTPTS[a{i}]')
filtros.append(''.join(f'[a{i}]' for i in range(9)) + 'concat=n=9:v=0:a=1[out]')
comando = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error']
for archivo in archivos:
    comando += ['-i', str(archivo)]
comando += ['-filter_complex', ';'.join(filtros), '-map', '[out]', '-c:a', 'pcm_s16le', 'audio/narracion.wav']
subprocess.run(comando, check=True)
print('Narración sincronizada: audio/narracion.wav')
