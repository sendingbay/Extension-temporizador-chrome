# Daily Timer — Extensión de Chrome

Temporizador de Daily para equipos. Se integra directamente en el **sidebar de Notion** y gestiona los turnos de 2 minutos por persona, con detección automática de participantes desde el tablero abierto.

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

### 1. Abrir el panel

El panel se inyecta automáticamente en el **sidebar de Notion**, justo debajo del elemento "Jira". Haz clic en **⏱ Daily Timer** para expandirlo o colapsarlo.

> No cubre el contenido de la página — está integrado en el sidebar como un elemento más de la navegación.

### 2. Cargar participantes

Pulsa **"📄 Cargar lista"** dentro del panel. La extensión:
- Expande automáticamente todos los grupos colapsados ("Cargar más grupos")
- Lee los nombres de las columnas del tablero Notion activo
- Filtra entradas de ruido (cabeceras de grupo, botones de UI, etc.)

> La carga es completamente automática — no es necesario interactuar con Notion antes de pulsar el botón.

### 3. Gestionar la Daily

| Control | Acción |
|---|---|
| **▶ / ⏸** | Iniciar o pausar el temporizador |
| **→** | Pasar al siguiente participante (omite ausentes) |
| **↺** | Reiniciar el contador a 2:00 sin cambiar de persona |
| **🔀** | Aleatorizar el orden de los participantes |
| **✕ / ✓** (por persona) | Marcar o desmarcar como ausente |
| Clic en un nombre | Saltar directamente a ese turno |

### 4. Avisos

- A los **10 segundos** restantes el contador parpadea en amarillo y suena un pitido doble.
- Al llegar a **0:00** suena un acorde final y el timer se detiene.
- El contador muestra `X de Y · Z ausentes` en tiempo real.
- El estado se conserva aunque cierres y vuelvas a abrir Notion.

---

## Panel en el sidebar

El panel usa el **tema oscuro de Notion** y se comporta como un elemento nativo del sidebar:

- Fondo y colores idénticos al resto de la interfaz de Notion.
- El participante activo se resalta en azul (`#2383e2`).
- Los participantes que ya han hablado aparecen en verde.
- El hover sobre los nombres es suave, sin parpadeos.

---

## Modo API (opcional)

Carga los participantes ordenados por número de tareas usando la API oficial de Notion. Requiere permisos de administrador en el workspace.

1. Ve a [notion.so/my-integrations](https://www.notion.so/my-integrations) → **"New integration"** y copia el token `secret_...`.
2. En la página de Notion, ve a **··· → Connections** y conecta la integración.
3. En la extensión, abre **⚙️** e introduce el token y la URL de la base de datos.

> El ID de la base de datos está en la URL: `notion.so/workspace/`**`<id>`**`?v=...`

---

## Archivos del proyecto

```
manifest.json    Configuración de la extensión (Manifest v3)
background.js    Service worker: estado del timer, mensajería
content.js       Inyección del panel en el sidebar de Notion, extracción de participantes
popup.html/js    Popup de la extensión (vista alternativa)
options.html/js  Página de configuración de credenciales API
```
