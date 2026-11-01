import { readFile, mkdir, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { sintetizar } from '../src/voz.js';

const texto = await readFile(resolve('VOZ.md'), 'utf8');
const lineas = [...texto.matchAll(/^\d+\. \*\*[^*]+\.\*\* «([^»]+)»/gm)].map(m => m[1]);
if (lineas.length !== 9) throw new Error(`Se esperaban 9 escenas y hay ${lineas.length}`);
await mkdir('audio', { recursive: true });
for (let i = 0; i < lineas.length; i++) {
  const temporal = await sintetizar(lineas[i], resolve('audio'));
  if (!temporal) throw new Error(`Falló la escena ${i + 1}`);
  await rename(join('audio', temporal), join('audio', `escena-${i + 1}.mp3`));
  process.stdout.write(`Voz ${i + 1}/9 lista\n`);
}
