// Base de datos: un solo archivo SQLite. Todas las tablas llevan el negocio,
// así el mismo sistema atiende a muchos negocios sin mezclar datos.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ruta = process.env.DB_RUTA || './datos/petalos.db';
mkdirSync(dirname(ruta), { recursive: true });
export const db = new DatabaseSync(ruta);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS charlas (
  id INTEGER PRIMARY KEY,
  negocio TEXT NOT NULL,
  canal TEXT NOT NULL,              -- whatsapp | web
  chat_id TEXT NOT NULL,
  nombre TEXT,
  estado TEXT NOT NULL DEFAULT '{}', -- lo que ya sabemos del pedido
  atiende TEXT NOT NULL DEFAULT 'flora', -- flora | persona
  derivada_en INTEGER,
  ultimo_mensaje_en INTEGER,
  creada_en INTEGER NOT NULL,
  UNIQUE (negocio, canal, chat_id)
);

CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY,
  charla_id INTEGER NOT NULL REFERENCES charlas(id),
  quien TEXT NOT NULL,              -- cliente | flora | persona
  texto TEXT NOT NULL,
  en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mensajes_charla ON mensajes(charla_id, id);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY,
  negocio TEXT NOT NULL,
  charla_id INTEGER NOT NULL REFERENCES charlas(id),
  estado TEXT NOT NULL DEFAULT 'nuevo', -- nuevo | preparando | en_camino | entregado | cancelado
  datos TEXT NOT NULL,
  total INTEGER NOT NULL,
  hora_limite INTEGER,
  creado_en INTEGER NOT NULL,
  cambiado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pedidos_negocio ON pedidos(negocio, estado);

CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY,
  negocio TEXT NOT NULL,
  charla_id INTEGER NOT NULL REFERENCES charlas(id),
  motivo TEXT NOT NULL,
  resumen TEXT NOT NULL,
  resuelto INTEGER NOT NULL DEFAULT 0,
  creado_en INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS avisos_negocio ON avisos(negocio, resuelto);
`);

const ahora = () => Date.now();

export function charla(negocio, canal, chatId, nombre) {
  let c = db.prepare('SELECT * FROM charlas WHERE negocio=? AND canal=? AND chat_id=?').get(negocio, canal, chatId);
  if (!c) {
    db.prepare('INSERT INTO charlas (negocio, canal, chat_id, nombre, creada_en) VALUES (?,?,?,?,?)')
      .run(negocio, canal, chatId, nombre || null, ahora());
    c = db.prepare('SELECT * FROM charlas WHERE negocio=? AND canal=? AND chat_id=?').get(negocio, canal, chatId);
  } else if (nombre && !c.nombre) {
    db.prepare('UPDATE charlas SET nombre=? WHERE id=?').run(nombre, c.id);
    c.nombre = nombre;
  }
  c.estado = JSON.parse(c.estado);
  return c;
}

export function charlaPorId(id) {
  const c = db.prepare('SELECT * FROM charlas WHERE id=?').get(id);
  if (c) c.estado = JSON.parse(c.estado);
  return c;
}

export function guardarEstado(c) {
  db.prepare('UPDATE charlas SET estado=?, atiende=?, derivada_en=?, nombre=? WHERE id=?')
    .run(JSON.stringify(c.estado), c.atiende, c.derivada_en ?? null, c.nombre ?? null, c.id);
}

export function anotar(charlaId, quien, texto) {
  const en = ahora();
  db.prepare('INSERT INTO mensajes (charla_id, quien, texto, en) VALUES (?,?,?,?)').run(charlaId, quien, texto, en);
  if (quien === 'cliente') db.prepare('UPDATE charlas SET ultimo_mensaje_en=? WHERE id=?').run(en, charlaId);
  return en;
}

export function historial(charlaId, cuantos = 14) {
  return db.prepare('SELECT quien, texto, en FROM mensajes WHERE charla_id=? ORDER BY id DESC LIMIT ?')
    .all(charlaId, cuantos).reverse();
}

export function crearPedido(negocio, charlaId, datos, total, horaLimite) {
  const en = ahora();
  const r = db.prepare('INSERT INTO pedidos (negocio, charla_id, datos, total, hora_limite, creado_en, cambiado_en) VALUES (?,?,?,?,?,?,?)')
    .run(negocio, charlaId, JSON.stringify(datos), total, horaLimite ?? null, en, en);
  return pedido(Number(r.lastInsertRowid));
}

export function pedido(id) {
  const p = db.prepare('SELECT * FROM pedidos WHERE id=?').get(id);
  if (p) p.datos = JSON.parse(p.datos);
  return p;
}

export function pedidosEn(negocio, estados) {
  return db.prepare(`SELECT * FROM pedidos WHERE negocio=? AND estado IN (${estados.map(() => '?').join(',')})
    ORDER BY COALESCE(hora_limite, creado_en)`).all(negocio, ...estados).map(p => ({ ...p, datos: JSON.parse(p.datos) }));
}

export function cambiarTotal(id, total) {
  db.prepare('UPDATE pedidos SET total=?, cambiado_en=? WHERE id=?').run(total, Date.now(), id);
}

export function sumarDatos(id, extra) {
  const p = pedido(id);
  if (p) db.prepare('UPDATE pedidos SET datos=? WHERE id=?').run(JSON.stringify({ ...p.datos, ...extra }), id);
}

export function cambiarPedido(id, estado) {
  db.prepare('UPDATE pedidos SET estado=?, cambiado_en=? WHERE id=?').run(estado, ahora(), id);
  return pedido(id);
}

export function crearAviso(negocio, charlaId, motivo, resumen) {
  db.prepare('UPDATE avisos SET resuelto=1 WHERE charla_id=? AND resuelto=0').run(charlaId);
  const r = db.prepare('INSERT INTO avisos (negocio, charla_id, motivo, resumen, creado_en) VALUES (?,?,?,?,?)')
    .run(negocio, charlaId, motivo, resumen, ahora());
  return Number(r.lastInsertRowid);
}

export function agregarAlAviso(charlaId, linea) {
  db.prepare("UPDATE avisos SET resumen = resumen || char(10) || ? WHERE charla_id=? AND resuelto=0").run(linea, charlaId);
}

export function resolverAvisos(charlaId) {
  db.prepare('UPDATE avisos SET resuelto=1 WHERE charla_id=? AND resuelto=0').run(charlaId);
}

// Todo lo que muestra el panel del dueño, en una sola consulta por tabla.
export function tablero(negocio) {
  const desde = new Date(); desde.setHours(0, 0, 0, 0);
  const pedidos = db.prepare(`
    SELECT p.*, c.nombre, c.canal, c.chat_id FROM pedidos p JOIN charlas c ON c.id=p.charla_id
    WHERE p.negocio=? AND (p.estado NOT IN ('entregado','cancelado') OR p.cambiado_en >= ?)
    ORDER BY COALESCE(p.hora_limite, p.creado_en)`).all(negocio, desde.getTime())
    .map(p => ({ ...p, datos: JSON.parse(p.datos) }));
  const avisos = db.prepare(`
    SELECT a.*, c.nombre, c.canal, c.chat_id, c.atiende FROM avisos a JOIN charlas c ON c.id=a.charla_id
    WHERE a.negocio=? AND a.resuelto=0 ORDER BY a.creado_en`).all(negocio);
  const hoy = db.prepare(`
    SELECT COUNT(*) AS pedidos, COALESCE(SUM(total),0) AS vendido,
      COALESCE(SUM(json_extract(datos,'$.rescatada')),0) AS rescatadas FROM pedidos
    WHERE negocio=? AND estado!='cancelado' AND creado_en >= ?`).get(negocio, desde.getTime());
  const charlasHoy = db.prepare('SELECT COUNT(*) AS n FROM charlas WHERE negocio=? AND ultimo_mensaje_en >= ?')
    .get(negocio, desde.getTime()).n;
  return { pedidos, avisos, hoy: { ...hoy, charlas: charlasHoy } };
}
