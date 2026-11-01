# Pétalos de Emergencia · Informe para el jurado
Hackatón DonWeb Day Rosario · 1/11/2026 · Franco Ledesma

> "La florería para los que se mandaron una macana."
> **Flora**, una asistente con IA, atiende la florería por WhatsApp y por la web las 24 horas, toma el pedido completo y coordina al dueño, al taller y al reparto.

---

## 1. Dónde probarlo (todo en vivo)

| Qué | Dirección |
|---|---|
| **App pública (Cloud Server DonWeb)** | https://petalos.hackaton.somosandromeda.store |
| Catálogo | https://petalos.hackaton.somosandromeda.store/catalogo |
| Panel del dueño (CRM, pedidos, reparto en vivo) | https://petalos.hackaton.somosandromeda.store/panel |
| Taller (qué armar y tarjetas) | https://petalos.hackaton.somosandromeda.store/taller |
| Reparto (ruta con IA y mapa) | https://petalos.hackaton.somosandromeda.store/reparto |
| Estado del sistema | https://petalos.hackaton.somosandromeda.store/api/salud |
| **Qué hicimos + video demo** | https://petalos.hackaton.somosandromeda.store/hackaton |
| Sitio Simple de DonWeb (vidriera) | https://petalos-de-emergencia.misitiosimple.online |
| **WhatsApp de Flora** | +54 9 11 2396-7106 |

**Las claves de los paneles van en el mail de entrega** (no se suben al repositorio).

### Probalo por WhatsApp
Escaneá el QR, mandá "Hola Flora" y pedí un ramo como si fueras un cliente.

![QR para hablar con Flora](public/qr-flora.png)

- **Para empezar de cero** (que Flora olvide la charla anterior de tu número): escribile `reiniciar`.
- Podés mandarle **audios**: los entiende y te contesta con audio corto.
- Escribí "quiero hablar con una persona" para ver el traspaso al dueño.

### Probalo por la web
En la portada está el mismo chat de Flora y el botón **"Llamar a Flora"** (conversación por voz desde el navegador, con ElevenLabs).

---

## 2. El problema que resolvemos
Un negocio de barrio pierde ventas porque atiende a mano: mensajes sin responder, el que escribe a la noche recibe respuesta al otro día, pedidos anotados que se pierden, clientes que esperan y se van.

## 3. Qué hace
1. **Atiende 24/7 y al instante** (≈3 s por respuesta), también de noche.
2. **Toma el pedido completo sola**, con botones: qué pasó → ramo → colores (o "Sorprendeme") → tarjeta en 3 tonos → día, hora, dirección, quién recibe → WhatsApp de quien recibe → resumen → confirmar.
3. **Nunca inventa precios**: el total lo calcula el sistema con la ficha del negocio, no la IA.
4. **Vende más**: ofrece extras (bombones, peluche, globo) antes y después de confirmar.
5. **Rescata ventas**: si el cliente se queda callado 3 minutos, lo retoma una vez.
6. **Nadie queda sin respuesta**: si piden una persona o hay un reclamo, el dueño recibe el caso resumido por WhatsApp; si no contesta en 2 minutos, Flora vuelve.
7. **Equipo coordinado por roles**: dueño (panel en vivo), taller (qué armar + tarjeta), reparto (ruta ordenada con IA, mapa en vivo y calendario de entregas).
8. **Experiencia que enamora**: vista previa del ramo dibujada con IA, regalo por WhatsApp a quien recibe, tarjeta de agradecimiento con el pedido completo, respuestas por audio, reseñas con botones.
9. **Aguanta mucha gente**: prueba de carga con 20 clientes a la vez → 20/20 pedidos, 0 errores, ~3 s por respuesta.

**La visión:** todo lo propio del negocio vive en una ficha (`fichas/petalos.json`: productos, precios, horarios, zonas, tono). Cambiando la ficha, la misma plataforma podría atender una pizzería, una veterinaria o una ferretería. *Hoy está hecha para la florería; lo demás es el camino.*

---

## 4. Componentes

| Componente | Qué es | Dónde |
|---|---|---|
| Sitio / portada | Presentación, catálogo, chat web y llamada por voz | `public/index.html`, `public/app.js`, `public/flora-home.*` |
| Asistente (Flora) | Entiende al cliente y arma el pedido. La IA entiende, el código decide precios y pasos | `src/cerebro.js` |
| WhatsApp | Recibe y manda mensajes, imágenes y audios (GREEN-API) | `src/whatsapp.js` |
| Panel del dueño / CRM | Números del día, pedidos en vivo, avisos, reseñas, reparto en vivo | `public/panel.html`, `public/panel.js` |
| Taller | Pedidos por armar con la tarjeta | `public/taller.*` |
| Reparto | Ruta ordenada con IA, mapa y calendario | `src/reparto.js`, `public/reparto.*`, `public/mapa-ui.js` |
| Imágenes y audio | Ramo dibujado y tarjetas (API del evento), audios a texto | `src/evento.js` |
| Voz | Respuestas habladas con ElevenLabs | `src/voz.js`, `src/hablado.js` |
| Base de datos | SQLite (charlas, mensajes, pedidos, avisos, reseñas) | `src/db.js` |
| Servidor | Node.js sin frameworks, eventos en vivo al panel | `server.js` |

**Nota sobre el mapa del reparto:** si no hay entregas reales del día, el mapa muestra una **simulación** marcada como tal (5 entregas de ejemplo que recorren calles reales de Rosario, con botón "Marcar entregado"). Con pedidos reales, muestra los reales.

---

## 5. Stack y cómo correrlo
- **Node.js 24** (usa el SQLite que viene con Node), una sola dependencia: `@anthropic-ai/sdk`.
- **IA:** Claude (Anthropic) para la charla; API del evento (formato OpenAI) para imágenes y transcripción; ElevenLabs para voz.
- **Infra:** Cloud Server DonWeb (Ubuntu 24.04, 2 vCPU / 4 GB), servicio de sistema + proxy con HTTPS. Dominio: subdominio de somosandromeda.store.

```bash
cp .env.ejemplo .env   # completar claves
npm install
npm start              # http://localhost:3000
npm run probar -- https://petalos.hackaton.somosandromeda.store   # pruebas de punta a punta
```

Para revisar el front no hace falta tocar nada: todo está en `public/` (HTML, CSS y JS sin compilar).

---

## 6. Cómo lo hicimos
Trabajo individual con dos asistentes de IA coordinados: **Claude Code** (servidor, Flora, WhatsApp, base de datos, publicación) y **Codex** (pantallas, catálogo, video). Se coordinaron por escrito en `BUZON.md`, que queda en el repo como bitácora. Todo el código empezó a las 16:00 del día del evento (ver historial de cambios).

---

## 7. Lo que encontramos en DonWeb
- **El panel no dejaba guardar llaves SSH** (error 500 con llaves ed25519 y RSA, 30/10). Eso obliga a entrar al servidor con la contraseña de root, que es menos seguro. Lo resolvimos cargando la llave directamente en el servidor.
- **Endurecimos el servidor nosotros:** acceso SSH solo con llave (contraseña desactivada), fail2ban arreglado para Ubuntu 24.04, actualizaciones de seguridad automáticas, ajustes del sistema y respaldo de la configuración.
- El panel de Coolify devolvía 503 porque la imagen viene sin dominio configurado; hubo que configurarlo a mano.

---

## 8. Lo que es real y lo que no
- Los mensajes de WhatsApp, las imágenes, los audios y los pedidos son **reales** (probados de punta a punta).
- El **pago** queda "informado" por el cliente, no verificado (no hay pasarela conectada).
- La florería es **ficticia**, creada para la hackatón.
- El asistente de **llamada por voz** orienta y deriva al chat o a WhatsApp; no registra pedidos.

---

## 9. Infraestructura en DonWeb
- **Cloud Server DonWeb** "Hackaton Donweb Day 2026" · **ID 6577528** · 2 vCPU / 4 GB RAM · Ubuntu 24.04 LTS (imagen con Coolify) · IP 201.32.132.99.
- **Dominio:** `petalos.hackaton.somosandromeda.store` (DNS en Hostinger: `hackaton` y `*.hackaton` apuntan al server). El dominio .com.ar del evento no llegó.
- **App:** contenedor Docker (Node.js 24) con reinicio automático, detrás del proxy **Traefik de Coolify**, HTTPS automático con Let's Encrypt y redirección http → https.
- **Datos:** SQLite en un volumen persistente. Las claves de las APIs viven solo en el `.env` del servidor.
- **Publicación:** se empaqueta el código, se sube por SSH y `desplegar.sh` reconstruye la imagen y reinicia el contenedor en segundos.
- **Coolify:** panel en `panel.hackaton.somosandromeda.store`, conectado a GitHub (publicación automática con push probada con una plantilla base).
- **Seguridad agregada:** SSH solo con llave y en puerto no estándar, fail2ban para Ubuntu 24.04, actualizaciones de seguridad automáticas, ajustes de red del sistema, respaldo de la configuración. En la app: límites de mensajes por sesión y por red, claves por rol en los paneles.
