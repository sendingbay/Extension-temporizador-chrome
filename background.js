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
  participants: []   // [{ name: string, taskCount: number }]
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
          const len = timerState.participants.length;
          timerState.currentIndex = len > 0 ? (timerState.currentIndex + 1) % len : 0;
          timerState.running   = false;
          timerState.startTime = null;
          timerState.elapsed   = 0;
          saveState();
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
