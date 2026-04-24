# Daily Timer — Extensión de Chrome

Temporizador de Daily conectado a una base de datos de Notion. Gestiona los turnos de 2 minutos por persona, igual que el temporizador de Jira, con soporte para ausentes, salto directo y dos modos de conexión con Notion (API y lectura de DOM).

---

## Índice

1. [Características](#características)
2. [Arquitectura del proyecto](#arquitectura-del-proyecto)
3. [Cómo funciona](#cómo-funciona)
4. [Instalación](#instalación)
5. [Cargar participantes desde Notion](#cargar-participantes-desde-notion)
6. [Uso durante la Daily](#uso-durante-la-daily)
7. [Preguntas frecuentes](#preguntas-frecuentes)

---

## Características

- Temporizador regresivo de **2 minutos** por persona.
- Botón de **play / pause** para pausar y reanudar en cualquier momento.
- **Aviso visual y sonoro** cuando quedan 10 segundos (contador en rojo + pitido).
- **Sonido de fin** al llegar a 0:00.
- **Dos modos de carga de participantes:**
  - **📄 Desde página** — lee la pestaña de Notion abierta en Chrome, sin credenciales ni configuración.
  - **↻ API** — consulta la API de Notion (requiere token de integración) y ordena por número de tareas.
- **Marcar ausentes**: botón ✕ por persona; los ausentes se omiten al pulsar ⏭.
- **Salto directo**: clic en cualquier nombre de la lista para ir a ese turno inmediatamente.
- **Contador inteligente**: muestra `X de Y · Z ausentes` en tiempo real.
- Las credenciales de API se guardan localmente en Chrome y nunca salen del navegador.

---

## Arquitectura del proyecto

```
├── manifest.json   # Configuración de la extensión (Manifest v3)
├── background.js   # Service worker: API de Notion, lectura de DOM, estado del timer
├── popup.html      # Interfaz principal (aparece al hacer clic en el icono)
├── popup.js        # Lógica del popup: renderizado, controles y bucle de actualización
├── options.html    # Página de configuración de credenciales de la API
├── options.js      # Guarda y carga las credenciales en chrome.storage.sync
└── content.js      # Script inyectado en notion.so: extrae nombres del DOM
```

### Flujo de datos — Modo API

```
Popup (UI)
  │  mensajes chrome.runtime
  ▼
background.js (service worker)
  │  fetch()
  ▼
API de Notion  ──►  Páginas de la base de datos
                    Agrupadas y ordenadas por nº de tareas
                    Devueltas al popup
```

### Flujo de datos — Modo DOM

```
Popup (UI)
  │  FETCH_FROM_DOM
  ▼
background.js
  │  chrome.tabs.sendMessage()
  ▼
content.js (inyectado en la pestaña de Notion)
  │  extrae nombres del DOM
  ▼
background.js  ──►  popup
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
| `absent` | array | Índices de participantes marcados como ausentes |

El tiempo restante se calcula en tiempo real en el popup:

```
restante = duration - elapsed - (Date.now() - startTime)
```

### Mensajes entre popup y background

| Mensaje | Acción |
|---|---|
| `GET_STATE` | Devuelve el estado actual del timer |
| `FETCH_FROM_DOM` | Lee nombres de la pestaña de Notion abierta (sin credenciales) |
| `FETCH_PARTICIPANTS` | Consulta la API de Notion y reinicia el estado |
| `START_PAUSE` | Alterna entre play y pause |
| `RESET_TIMER` | Reinicia el contador a 2:00 |
| `NEXT_PERSON` | Pasa al siguiente participante no ausente y reinicia |
| `TOGGLE_ABSENT` | Marca/desmarca a una persona como ausente |
| `JUMP_TO` | Salta directamente al participante indicado |

### Extracción de nombres por DOM (`content.js`)

El script se inyecta automáticamente en cualquier página de `notion.so` y aplica cuatro estrategias en cascada:

1. **Vista tabla** — primera celda (`role="gridcell"`) de cada fila (`role="row"`)
2. **Vista tablero** — texto de las tarjetas (`role="button"`)
3. **Vista lista / galería** — texto de los elementos `role="link"`
4. **Fallback** — elementos `contenteditable` de una sola línea en el área principal

### Integración con la API de Notion

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
- Para el modo API: acceso de administrador a la integración de Notion del workspace.
- Para el modo DOM: simplemente tener la página de Notion abierta en Chrome.

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

### Actualizar la extensión

Cada vez que se actualice el repositorio, ve a `chrome://extensions`, localiza Daily Timer y pulsa el botón **↺** de recarga. No es necesario reinstalar.

---

## Cargar participantes desde Notion

Hay dos modos. Usa el que se adapte a tu situación:

### Modo 📄 Desde página (recomendado — sin credenciales)

1. Abre tu base de datos de Notion en Chrome en **vista tabla**.
2. Abre el popup de la extensión → pulsa **"📄 Desde página"**.
3. La extensión lee los nombres de la primera columna de la tabla visible.

> La pestaña de Notion puede estar en segundo plano, no necesita estar activa.

### Modo ↻ API (requiere token de integración)

Este modo permite además ordenar los participantes por número de tareas.

#### 1. Crear una integración de Notion

1. Ve a [notion.so/my-integrations](https://www.notion.so/my-integrations).
2. Clic en **"New integration"**.
3. Ponle un nombre (p. ej. `Daily Timer`) y selecciona tu workspace.
4. Copia el **Internal Integration Token** (`secret_...`).

> Solo los administradores del workspace pueden crear integraciones.

#### 2. Compartir la base de datos con la integración

1. Abre la base de datos de la Daily en Notion **como página completa** (no como vista incrustada).
2. Haz clic en los `···` (menú superior derecho).
3. Ve a **Connections** → busca tu integración → **Connect**.

#### 3. Copiar la URL de la base de datos

La URL debe ser la de la base de datos original:
```
https://www.notion.so/tu-workspace/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

> ⚠️ Si la tabla está incrustada en otra página, haz clic en **"Open as full page"** primero.

#### 4. Configurar la extensión

1. Clic en el icono de la extensión → **⚙️**.
2. Rellena los campos:

   | Campo | Descripción |
   |---|---|
   | **Token de integración** | El `secret_...` copiado en el paso 1 |
   | **ID / URL de la base de datos** | La URL completa de Notion |
   | **Propiedad con el nombre** | Nombre exacto de la columna con el nombre de la persona (por defecto: `Name`) |
   | **Propiedad con el nº de tareas** | Columna numérica, relación o rollup (opcional; si se omite, el orden es el de la base de datos) |

3. **Guardar configuración**.

---

## Uso durante la Daily

1. Abre el popup de la extensión.
2. Carga los participantes con **"📄 Desde página"** o **"↻ API"**.
3. Si alguien no ha venido, pulsa **✕** junto a su nombre para marcarlo como ausente (aparece tachado y se omitirá automáticamente).
4. Pulsa **▶** para iniciar el cronómetro de 2:00 del primer turno.
5. A los **10 segundos restantes**: el contador se pone en rojo y suena un aviso.
6. Al llegar a **0:00**: suena el final y el timer se detiene automáticamente.
7. Pulsa **⏭** para pasar al siguiente participante (los ausentes se saltan solos).
8. Pulsa sobre cualquier **nombre de la lista** para saltar directamente a ese turno.
9. **↺** reinicia el timer sin cambiar de persona.
10. **⏸ / ▶** pausa y reanuda en cualquier momento.

---

## Preguntas frecuentes

**¿Las credenciales son seguras?**
Sí. Se guardan únicamente en `chrome.storage.sync`, cifrado por Chrome y vinculado a tu cuenta de Google. Nunca se envían a ningún servidor propio.

**¿Por qué sale el error "multiple data sources"?**
La URL que has puesto corresponde a una vista vinculada (*linked database*). Abre la base de datos original en Notion y usa esa URL. O usa el modo **"📄 Desde página"** que no tiene esta limitación.

**No tengo permisos para crear integraciones en el workspace.**
Usa el modo **"📄 Desde página"**: abre la base de datos en Notion y pulsa el botón sin necesidad de configurar nada. Si en el futuro el administrador crea la integración, puedes configurar el modo API en ⚙️ para obtener también el ordenado por tareas.

**¿El timer sigue corriendo si cierro el popup?**
El estado se guarda en el service worker. Si Chrome termina el service worker por inactividad, el tiempo transcurrido se conserva y el timer aparecerá como pausado la próxima vez que abras el popup.

**¿Puedo cambiar los 2 minutos?**
Sí, cambia el valor de `duration` en el estado inicial de `background.js`:
```js
duration: 120000,  // milisegundos → 120 000 = 2 minutos
```

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

