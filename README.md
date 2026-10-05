# Mañanas

Webapp (PWA) para recuperar las mañanas y salir del bucle de scroll. Está pensada para un problema concreto: coger el móvil nada más despertar y perder la mañana en Instagram, X o YouTube Shorts.

## Cómo funciona

La app no intenta ser otra app que mirar. Hace pocas cosas, en los momentos que importan:

| Momento | Qué hace |
|---|---|
| **Noche** (aviso 30 min antes y a la hora) | En dos minutos eliges lo primero que harás mañana y dejas el móvil cargando **fuera del cuarto**. Pulsas «Aparcado». |
| **Al apagar la alarma** (Atajo de iOS) | Se abre tu mañana: **un solo paso a la vez** en grande (sentarte, persiana, agua, bajar a la perrita…). Si tienes poca energía, haces la *versión corta*, que cuenta igual. |
| **Al abrir Instagram o YouTube** (Atajo de iOS) | Pausa de 8 segundos respirando, la pregunta «¿qué te ha traído aquí?» y una alternativa según tu energía. Si buscas algo concreto, puedes entrar 5 minutos y te avisa cuando acaben. Si tu mañana está a medias, te devuelve a ella. |
| **Candado** | Genera un código de Tiempo de uso que **no te sabes**. Solo lo ves si completas tu mañana o esperas 15 min. Al verlo se rota por uno nuevo. Así los límites no se saltan con un toque. |
| **Progreso** | Soles por cada mañana ganada. **Sin rachas que romper**: la semana empieza limpia y el total solo sube. Con unas semanas de uso, te muestra cuántas mañanas ganas cuando aparcas el móvil a tu hora y cuántas cuando no. |

La mañana se gana la noche anterior, por eso la app trabaja sobre todo en esos dos momentos. No depende de ningún otro dispositivo ni servicio: todo sale de lo que marcas en la propia app.

### Por qué es una webapp y no una app nativa

Para bloquear apps desde código, Apple obliga a usar la API de Tiempo de uso (FamilyControls) desde una app nativa con un permiso especial que Apple concede a mano. **AltStore, SideStore y LiveContainer no conservan ese permiso**, así que una app nativa instalada por esas vías no podría bloquear nada. Esta app usa tres cosas que sí funcionan:

1. **Tiempo de uso de iOS** hace el bloqueo real, con un código que la app te esconde (Candado).
2. **Automatizaciones de Atajos** ponen la pausa al abrir apps y abren la mañana al apagar la alarma.
3. **Notificaciones web push**, que funcionan en PWAs instaladas en la pantalla de inicio desde iOS 16.4.

## Despliegue en Railway

1. En Railway: **New Project → Deploy from GitHub repo →** `phone_detox`.
2. En el mismo proyecto: **+ New → Database → PostgreSQL**.
3. En el servicio de la app, pestaña **Variables**:
   - `APP_TOKEN` = un código largo que te inventes (es tu contraseña)
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `VAPID_SUBJECT` = `mailto:tu@correo.com`
4. **Settings → Networking → Generate Domain**. Esa es la URL de la app.
5. En el iPhone, abre la URL en **Safari**, mete el código y pulsa **Compartir → Añadir a pantalla de inicio**.
6. Abre la app **desde el icono** → Ajustes → **Activar notificaciones** → «Enviar una de prueba».

Las claves de notificaciones se generan solas la primera vez y se guardan en Postgres.

## Configuración en el iPhone (una sola vez)

Dentro de la app tienes **Ajustes → Guía de Atajos de iOS**, con tus URLs listas para copiar. En resumen:

- **Instagram / YouTube**: Atajos → Automatización → App → «Se abre» → Ejecutar inmediatamente → *Obtener contenido de URL* `…/api/gate?app=instagram&t=…` → *Si* contiene `pausa` → *Abrir URL* `…/#/pausa?app=instagram&t=…`
- **Alarma**: Automatización → Alarma → «Se detiene» → *Abrir URL* `…/#/manana?t=…`
- **Tiempo de uso**: en la pestaña Candado están los pasos. Lo esencial es poner límites a Instagram, YouTube, `x.com`, `instagram.com` y `youtube.com`, y prohibir **instalar apps** para no poder reinstalar Instagram en un mal momento.

## Desarrollo local

```bash
npm install
APP_TOKEN=prueba npm run dev   # sin DATABASE_URL guarda en data/db.json
npm test
```

Estructura: `server.js` (API y avisos programados), `lib/` (lógica, fechas y almacenamiento), `public/` (PWA sin dependencias ni compilación).
