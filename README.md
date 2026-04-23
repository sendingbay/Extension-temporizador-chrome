# Daily Timer — Extensión de Chrome

Temporizador de Daily conectado a una base de datos de Notion. Ordena automáticamente a los participantes según el número de tareas que tienen y gestiona los turnos de 2 minutos, igual que el temporizador de Jira.

---

## Índice

1. [Características](#características)
2. [Arquitectura del proyecto](#arquitectura-del-proyecto)
3. [Cómo funciona](#cómo-funciona)
4. [Instalación](#instalación)
5. [Configuración de Notion](#configuración-de-notion)
6. [Uso durante la Daily](#uso-durante-la-daily)
7. [Preguntas frecuentes](#preguntas-frecuentes)

---

## Características

- Temporizador regresivo de **2 minutos** por persona.
- Botón de **play / pause** para pausar y reanudar en cualquier momento.
- **Aviso visual y sonoro** cuando quedan 10 segundos (contador en rojo + pitido).
- **Sonido de fin** al llegar a 0:00.
- **Ordenación automática** de participantes por número de tareas (más tareas → habla antes).
- Conexión directa con la **API de Notion**: los datos se cargan con un solo clic.
- Página de **configuración integrada** en el propio navegador; las credenciales nunca salen de Chrome.

---

## Arquitectura del proyecto

```
├── manifest.json   # Configuración de la extensión (Manifest v3)
├── background.js   # Service worker: llama a la API de Notion y gestiona el estado del timer
├── popup.html      # Interfaz principal (aparece al hacer clic en el icono)
├── popup.js        # Lógica del popup: renderizado, controles y bucle de actualización
├── options.html    # Página de configuración de credenciales
├── options.js      # Guarda y carga las credenciales en chrome.storage.sync
└── content.js      # (legacy) Script de inyección inicial, ya no usado
```

### Flujo de datos

```
Popup (UI)
  │  mensajes chrome.runtime
  ▼
background.js (service worker)
  │  fetch()
  ▼
API de Notion  ──►  Páginas de la base de datos
                    Ordenadas por nº de tareas
                    Devueltas al popup
```

El popup **nunca llama a Notion directamente**: lo delega al service worker para evitar problemas de CORS y mantener el estado del temporizador aunque el popup se cierre y vuelva a abrir.

---

## Cómo funciona

### Estado del temporizador

El estado se guarda en `chrome.storage.session` para que sobreviva al cierre del popup. Contiene:

| Campo | Tipo | Descripción |
|---|---|---|
| `running` | boolean | Si el timer está corriendo |
| `startTime` | number | `Date.now()` del último play |
| `elapsed` | number | Milisegundos ya consumidos |
| `duration` | number | Duración total (120 000 ms) |
| `currentIndex` | number | Índice del participante actual |
| `participants` | array | Lista ordenada `[{ name, taskCount }]` |

El tiempo restante se calcula en tiempo real en el popup:

```
restante = duration - elapsed - (Date.now() - startTime)
```

### Mensajes entre popup y background

| Mensaje | Acción |
|---|---|
| `GET_STATE` | Devuelve el estado actual del timer |
| `FETCH_PARTICIPANTS` | Consulta Notion y reinicia el estado |
| `START_PAUSE` | Alterna entre play y pause |
| `RESET_TIMER` | Reinicia el contador a 2:00 |
| `NEXT_PERSON` | Pasa al siguiente participante y reinicia |

### Integración con Notion

La función `fetchParticipants()` en `background.js`:

1. Lee las credenciales de `chrome.storage.sync`.
2. Pagina todos los registros de la base de datos (100 por llamada).
3. Agrupa los registros por nombre de persona.
4. Suma las tareas de cada persona (campo numérico, relación o rollup).
5. Ordena de mayor a menor número de tareas.

> **Limitación de la API de Notion:** Las bases de datos con múltiples fuentes de datos (*linked databases*) no están soportadas. Debes usar la URL de la base de datos original.

---

## Instalación

### Requisitos

- Google Chrome (versión 88 o superior).
- Acceso de administrador a la integración de Notion del workspace.

### Pasos

1. **Descarga el repositorio**

   ```bash
   git clone https://github.com/Monica-pxl/Extensi-n-Chrome.git
   ```

   O descarga el ZIP desde GitHub y descomprímelo.

2. **Abre el gestor de extensiones de Chrome**

   Escribe en la barra de direcciones:
   ```
   chrome://extensions
   ```

3. **Activa el modo desarrollador**

   Interruptor en la esquina superior derecha → **activado**.

4. **Carga la extensión**

   Haz clic en **"Cargar sin empaquetar"** y selecciona la carpeta del proyecto (la que contiene `manifest.json`).

5. **Ancla el icono (recomendado)**

   Icono del puzzle en la barra de Chrome → pin junto a **"Daily Timer"**.

---

## Configuración de Notion

### 1. Crear una integración

1. Ve a [notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Clic en **"New integration"**.
3. Ponle un nombre (p. ej. `Daily Timer`) y selecciona tu workspace.
4. Copia el **Internal Integration Token** (`secret_...`).

### 2. Compartir la base de datos con la integración

1. Abre la base de datos de la Daily en Notion **como página completa** (no como vista incrustada).
2. Haz clic en los `···` (menú superior derecho).
3. Ve a **Connections** → busca tu integración → **Connect**.

### 3. Copiar la URL de la base de datos

La URL debe ser la de la base de datos original, con el formato:
```
https://www.notion.so/tu-workspace/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

> ⚠️ Si la tabla está incrustada en otra página, haz clic en **"Open as full page"** primero para obtener la URL correcta.

### 4. Configurar la extensión

1. Clic en el icono de la extensión → **⚙️**.
2. Rellena los campos:

   | Campo | Descripción |
   |---|---|
   | **Token de integración** | El `secret_...` copiado en el paso 1 |
   | **ID / URL de la base de datos** | La URL completa de Notion |
   | **Propiedad con el nombre** | Nombre exacto del campo con el nombre de la persona (por defecto: `Name`) |
   | **Propiedad con el nº de tareas** | Campo numérico, relación o rollup (opcional) |

3. **Guardar configuración**.

---

## Uso durante la Daily

1. Abre el popup de la extensión.
2. Pulsa **"↻ Cargar Notion"** → la extensión consulta la base de datos y ordena a los participantes.
3. Pulsa **▶** para iniciar el cronómetro de 2:00 del primer turno.
4. A los **10 segundos restantes**: el contador se pone en rojo y suena un aviso.
5. Al llegar a **0:00**: suena el final y el timer se detiene automáticamente.
6. Pulsa **⏭** para pasar al siguiente participante (el timer vuelve a 2:00).
7. El botón **↺** reinicia el timer sin cambiar de persona.
8. El botón **⏸ / ▶** pausa y reanuda el timer en cualquier momento.

---

## Preguntas frecuentes

**¿Las credenciales son seguras?**
Sí. Se guardan únicamente en `chrome.storage.sync`, cifrado por Chrome y vinculado a tu cuenta de Google. Nunca se envían a ningún servidor propio.

**¿Por qué sale el error "multiple data sources"?**
La URL que has puesto corresponde a una vista vinculada (*linked database*). Abre la base de datos original en Notion y usa esa URL.

**¿El timer sigue corriendo si cierro el popup?**
El estado se guarda en el service worker. Si el service worker es terminado por Chrome (por inactividad), el tiempo transcurrido se conserva y el timer aparecerá como pausado la próxima vez que abras el popup.

**¿Puedo cambiar los 2 minutos?**
Sí, cambia el valor de `duration` en el estado inicial de `background.js`:
```js
duration: 120000,  // milisegundos → 120 000 = 2 minutos
```

