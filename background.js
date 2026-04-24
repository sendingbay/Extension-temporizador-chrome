// ==========================
// 🔧 ESTADO DEL TEMPORIZADOR
// ==========================

const NOTION_VERSION = "2022-06-28";

const DEFAULT_STATE = {
  running: false,
  startTime: null,   // Date.now() cuando se inició/reanudó
  elapsed: 0,        // ms transcurridos antes del último pause
  duration: 120000,  // 2 minutos en ms
  currentIndex: 0,
  participants: [],  // [{ name: string, taskCount: number }]
  absent: []         // índices de participantes marcados como ausentes
};

let timerState = { ...DEFAULT_STATE };

// Restaurar estado persistido cuando el service worker arranca
const stateReady = chrome.storage.session.get("timerState").then(result => {
  if (result.timerState) {
    timerState = result.timerState;
    // Si el service worker fue terminado mientras corría, pausar y conservar elapsed
    if (timerState.running && timerState.startTime) {
      timerState.elapsed = Math.min(
        timerState.duration,
        timerState.elapsed + (Date.now() - timerState.startTime)
      );
      timerState.startTime = null;
      timerState.running = false;
    }
  }
});

function saveState() {
  chrome.storage.session.set({ timerState });
}

// ==========================
// 🗃️ NOCIÓN API
// ==========================

function parseDatabaseId(input) {
  // Formato URL: .../XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX?v=...
  const urlMatch = input.match(/([a-f0-9]{32})(?:[?#]|$)/i);
  if (urlMatch) {
    const h = urlMatch[1];
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  // Formato UUID ya con guiones
  const uuidMatch = input.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (uuidMatch) return uuidMatch[0];
  throw new Error("ID de base de datos inválido. Copia la URL completa de Notion.");
}

async function queryAllPages(databaseId, notionKey) {
  const pages = [];
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      if (
        err.code === "validation_error" &&
        typeof err.message === "string" &&
        err.message.toLowerCase().includes("multiple data sources")
      ) {
        throw new Error(
          "Esta base de datos tiene múltiples fuentes de datos (linked database), " +
          "que la API de Notion no soporta. " +
          "Abre la base de datos original en Notion (no una vista vinculada), " +
          "copia su URL y úsala en la configuración."
        );
      }
      throw new Error(err.message || `Error ${res.status} de Notion`);
    }

    const data = await res.json();
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return pages;
}

function extractText(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title":     return prop.title.map(t => t.plain_text).join("").trim();
    case "rich_text": return prop.rich_text.map(t => t.plain_text).join("").trim();
    case "select":    return prop.select?.name?.trim() || "";
    case "people":    return prop.people.map(p => p.name).join(", ").trim();
    case "email":     return prop.email?.trim() || "";
    default:          return "";
  }
}

function extractNumber(prop) {
  if (!prop) return 0;
  switch (prop.type) {
    case "number":  return prop.number ?? 0;
    case "relation": return prop.relation.length;
    case "rollup":  return prop.rollup?.number ?? prop.rollup?.array?.length ?? 0;
    default:        return 0;
  }
}

async function fetchParticipants() {
  const config = await chrome.storage.sync.get(["notionKey", "databaseId", "nameProperty", "taskProperty"]);

  if (!config.notionKey || !config.databaseId) {
    throw new Error("Faltan credenciales. Configura la extensión en ⚙️.");
  }

  const databaseId = parseDatabaseId(config.databaseId);
  const nameProp   = config.nameProperty || "Name";
  const taskProp   = config.taskProperty || "";

  const pages = await queryAllPages(databaseId, config.notionKey);

  if (!taskProp) {
    // Cada página = una persona, sin conteo de tareas
    return pages
      .map(page => ({ name: extractText(page.properties[nameProp]) || "Sin nombre", taskCount: 1 }))
      .filter(p => p.name && p.name !== "Sin nombre");
  }

  // Agrupar por nombre y sumar tareas
  const map = {};
  for (const page of pages) {
    const name = extractText(page.properties[nameProp]);
    if (!name) continue;
    const count = extractNumber(page.properties[taskProp]);
    if (map[name]) {
      map[name].taskCount += count || 1;
    } else {
      map[name] = { name, taskCount: count || 1 };
    }
  }

  // Más tareas primero (más cosas que comentar en la Daily)
  return Object.values(map).sort((a, b) => b.taskCount - a.taskCount);
}

// ==========================
// 📨 MANEJADOR DE MENSAJES
// ==========================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    await stateReady;

    try {
      switch (msg.type) {

        case "GET_STATE":
          sendResponse({ timerState });
          break;

        case "FETCH_FROM_DOM": {
          const allTabs = await chrome.tabs.query({ url: "https://www.notion.so/*" });
          if (allTabs.length === 0) {
            throw new Error("No hay ninguna pestaña de Notion abierta. Abre tu base de datos en Notion primero.");
          }
          const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true, url: "https://www.notion.so/*" });
          const tab = activeTabs[0] || allTabs[0];

          // Función autocontenida que se inyecta y ejecuta directamente en la pestaña
          function notionScraper() {
            const NOISE = new Set([
              "New", "Filter", "Sort", "Search", "Group", "Properties",
              "Share", "Export", "Add a page", "Calculate", "Untitled",
              "No assignee", "Empty", "Count", "Open", "Delete", "Duplicate",
              "Skip to content", "···", "...", "Sin título", "Ir al contenido",
              "Sin asignar", "Vacío", "Nueva página", "+ Nueva página",
              "Nuevo", "Abrir", "Eliminar", "Filtrar", "Ordenar", "Agrupar",
              "Propiedades", "Compartir", "Añadir una página", "Calcular",
              "Todo", "Backlog", "Mis Tareas", "Involucrado", "Canva Activo",
              "Por Usuarios", "Canva / Sprints",
            ]);

            function clean(t) {
              return (t || "").replace(/\s+/g, " ").trim().replace(/\s+\d+\s*$/, "").trim();
            }

            function isNoise(t) {
              return !t || t.length < 2 || t.length > 60 || NOISE.has(t) || /^\d+$/.test(t);
            }

            function isInScroller(el) {
              let p = el.parentElement;
              while (p && p !== document.body) {
                const s = window.getComputedStyle(p);
                const oy = s.overflowY;
                const ox = s.overflowX;
                if (oy === "auto" || oy === "scroll" || ox === "auto" || ox === "scroll") return true;
                p = p.parentElement;
              }
              return false;
            }

            const results = [];
            const seen = new Set();

            function add(raw) {
              const t = clean(raw);
              if (isNoise(t) || seen.has(t)) return;
              seen.add(t);
              results.push(t);
            }

            // Estrategia 1: role="columnheader" (tablero)
            document.querySelectorAll('[role="columnheader"]')
              .forEach(el => add(el.textContent));

            // Estrategia 2: Cabeceras de columna fuera de scroll containers
            // Los títulos de columna del board NO están dentro de un scroller;
            // las tarjetas sí. Buscamos imágenes pequeñas (avatares) que no
            // están en zonas de scroll y leemos el texto del contenedor más próximo.
            if (results.length === 0) {
              document.querySelectorAll("img").forEach(img => {
                if (isInScroller(img)) return;
                const rect = img.getBoundingClientRect();
                if (rect.width < 8 || rect.width > 48 || rect.height > 48) return;
                // Subir hasta encontrar el contenedor del header de columna
                let el = img.parentElement;
                for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
                  const text = el.textContent || "";
                  const line = clean(text.split("\n")[0]);
                  if (!isNoise(line) && line.length <= 50) {
                    add(line);
                    break;
                  }
                }
              });
            }

            // Estrategia 3: Buscar todos los elementos de texto corto
            // que NO estén dentro de scroll containers (column headers del board)
            if (results.length === 0) {
              const walker = document.createTreeWalker(
                document.body, NodeFilter.SHOW_TEXT,
                { acceptNode: n => n.textContent.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
              );
              const byParent = new Map();
              let node;
              while ((node = walker.nextNode())) {
                const el = node.parentElement;
                if (!el || isInScroller(el)) continue;
                const t = clean(node.textContent);
                if (isNoise(t)) continue;
                const parent = el.parentElement || el;
                if (!byParent.has(parent)) byParent.set(parent, []);
                byParent.get(parent).push(t);
              }
              // Grupos de 3+ hermanos (cabeceras de columna del tablero)
              byParent.forEach((texts, parent) => {
                const siblings = parent.children.length;
                if (texts.length >= 3 && siblings >= 3) {
                  texts.forEach(t => add(t));
                }
              });
            }

            // Estrategia 4: Vista tabla — filas con 2+ celdas
            if (results.length === 0) {
              document.querySelectorAll('[role="row"]').forEach(row => {
                const cells = row.querySelectorAll('[role="gridcell"]');
                if (cells.length >= 2) add(cells[0].textContent);
              });
            }

            // Estrategia 5: Vista lista/galería
            if (results.length === 0) {
              document.querySelectorAll('[role="link"]').forEach(el => {
                const first = el.firstElementChild;
                add(first ? first.textContent : el.textContent);
              });
            }

            return results;
          }

          let names = [];
          try {
            const injected = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func:   notionScraper,
            });
            names = injected[0]?.result || [];
          } catch (e) {
            // Fallback: mensaje al content script ya inyectado
            try {
              const resp = await chrome.tabs.sendMessage(tab.id, { type: "GET_DOM_PARTICIPANTS" });
              names = resp?.names || [];
            } catch (_) {
              throw new Error("No se pudo acceder a la pestaña de Notion. Recarga la página de Notion e inténtalo de nuevo.");
            }
          }

          if (names.length === 0) {
            throw new Error("No se encontraron nombres. Asegúrate de que la vista \"Por Usuarios\" esté completamente cargada y visible, luego pulsa de nuevo.");
          }

          const participants = names.map(name => ({ name, taskCount: 1 }));
          timerState = { ...DEFAULT_STATE, participants };
          saveState();
          sendResponse({ success: true, participants });
          break;
        }

        case "FETCH_PARTICIPANTS": {
          const participants = await fetchParticipants();
          timerState = { ...DEFAULT_STATE, participants };
          saveState();
          sendResponse({ success: true, participants });
          break;
        }

        case "START_PAUSE":
          if (timerState.running) {
            // Pausar: guardar tiempo transcurrido
            timerState.elapsed = Math.min(
              timerState.duration,
              timerState.elapsed + (Date.now() - timerState.startTime)
            );
            timerState.startTime = null;
            timerState.running   = false;
          } else if (timerState.elapsed < timerState.duration) {
            // Iniciar / reanudar
            timerState.startTime = Date.now();
            timerState.running   = true;
          }
          saveState();
          sendResponse({ timerState });
          break;

        case "RESET_TIMER":
          timerState.running   = false;
          timerState.startTime = null;
          timerState.elapsed   = 0;
          saveState();
          sendResponse({ timerState });
          break;

        case "NEXT_PERSON": {
          const len    = timerState.participants.length;
          const absent = timerState.absent || [];
          if (len === 0) { sendResponse({ timerState }); break; }

          let next  = (timerState.currentIndex + 1) % len;
          let tries = 0;
          // Saltar ausentes
          while (absent.includes(next) && tries < len) {
            next = (next + 1) % len;
            tries++;
          }
          // Si todos están ausentes, no moverse
          if (tries < len) {
            timerState.currentIndex = next;
            timerState.running      = false;
            timerState.startTime    = null;
            timerState.elapsed      = 0;
          }
          saveState();
          sendResponse({ timerState });
          break;
        }

        case "TOGGLE_ABSENT": {
          const idx    = msg.index;
          const absent = timerState.absent ? [...timerState.absent] : [];
          const pos    = absent.indexOf(idx);
          if (pos === -1) absent.push(idx);
          else absent.splice(pos, 1);
          timerState.absent = absent;

          // Si marcamos como ausente a quien tiene el turno, pasar al siguiente
          if (absent.includes(idx) && timerState.currentIndex === idx) {
            const len = timerState.participants.length;
            let next  = (idx + 1) % len;
            let tries = 0;
            while (absent.includes(next) && tries < len) {
              next = (next + 1) % len;
              tries++;
            }
            if (tries < len) {
              timerState.currentIndex = next;
              timerState.running      = false;
              timerState.startTime    = null;
              timerState.elapsed      = 0;
            }
          }
          saveState();
          sendResponse({ timerState });
          break;
        }

        case "JUMP_TO": {
          const idx = msg.index;
          if (idx >= 0 && idx < timerState.participants.length) {
            timerState.currentIndex = idx;
            timerState.running      = false;
            timerState.startTime    = null;
            timerState.elapsed      = 0;
            saveState();
          }
          sendResponse({ timerState });
          break;
        }

        default:
          sendResponse({ error: "Mensaje desconocido" });
      }
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Canal abierto para respuesta asíncrona
});
