# Daily Timer — Extensión de Chrome

Temporizador de Daily para equipos, similar al de Jira. Carga los participantes desde un tablero de Notion abierto en Chrome y gestiona turnos de 2 minutos por persona.

---

## Instalación

1. Descarga o clona el repositorio:
   ```bash
   git clone https://github.com/Monica-pxl/Extensi-n-Chrome.git
   ```
2. En Chrome, abre `chrome://extensions`.
3. Activa el **Modo desarrollador** (esquina superior derecha).
4. Haz clic en **"Cargar sin empaquetar"** y selecciona la carpeta del proyecto.
5. (Opcional) Ancla el icono desde el puzzle de la barra de Chrome.

**Para actualizar:** ve a `chrome://extensions` y pulsa ↺ junto a Daily Timer.

---

## Cómo usarlo

### 1. Cargar participantes

Abre el tablero de Notion en Chrome (vista **"Por Usuarios"**) y pulsa **"📄 Desde página"** en el popup. La extensión leerá los nombres de las columnas automáticamente.

> La pestaña de Notion puede estar en segundo plano, no necesita estar activa.

### 2. Gestionar la Daily

| Control | Acción |
|---|---|
| **▶ / ⏸** | Iniciar o pausar el temporizador |
| **⏭** | Pasar al siguiente participante (omite ausentes) |
| **↺** | Reiniciar el contador a 2:00 sin cambiar de persona |
| **✕ / ✓** (por persona) | Marcar o desmarcar como ausente |
| Clic en un nombre | Saltar directamente a ese turno |

### 3. Avisos

- A los **10 segundos** restantes el contador parpadea en rojo y suena un pitido doble.
- Al llegar a **0:00** suena un acorde final y el timer se detiene.
- El contador muestra `X de Y · Z ausentes` en tiempo real.
- El estado se conserva si cierras y vuelves a abrir el popup.

---

## Modo API (opcional)

Carga los participantes ordenados por número de tareas usando la API de Notion. Requiere permisos de administrador en el workspace.

1. Ve a [notion.so/my-integrations](https://www.notion.so/my-integrations) → **"New integration"** y copia el token `secret_...`.
2. En la página de Notion, ve a **··· → Connections** y conecta la integración.
3. En la extensión, abre **⚙️** e introduce el token y la URL de la base de datos.
4. Usa el botón **↻ API** en lugar de "📄 Desde página".

> El ID de la base de datos está en la URL: `notion.so/workspace/`**`<id>`**`?v=...`

---

## Archivos del proyecto

```
manifest.json    Configuración de la extensión (Manifest v3)
background.js    Service worker: scraping del DOM, API de Notion, estado del timer
popup.html/js    Interfaz y lógica del popup
options.html/js  Página de configuración de credenciales API
content.js       Script de respaldo inyectado en notion.so
```
