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
  absent: [],        // índices de participantes marcados como ausentes
  done: []           // índices marcados manualmente como terminados
};

let timerState = { ...DEFAULT_STATE };

// Restaurar estado persistido cuando el service worker arranca
const stateReady = chrome.storage.session.get("timerState").then(result => {
  if (result.timerState) {
    timerState = result.timerState;
    // startTime es un timestamp de reloj real, por lo que el cálculo
    // "Date.now() - startTime" sigue siendo correcto aunque el service worker
    // haya sido terminado y reiniciado. No se pausa el temporizador.
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

          // Función autocontenida que se inyecta y ejecuta directamente en la pestaña.
          // Es async para poder recorrer el scroll horizontal del tablero y capturar
          // columnas virtualizadas que Notion elimina del DOM cuando están fuera de pantalla.
          async function notionScraper() {
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
              // Botones de UI de Notion (no son nombres de persona)
              "Nuevo grupo", "+ Nuevo grupo", "Cargar más grupos", "Cargar más",
              "New group", "+ New group", "Load more groups", "Load more",
              // Personas excluidas explícitamente
              "D.Casitas", "Daniel D'Orazio", "Sin Asignado",
            ]);

            function clean(t) {
              return (t || "").replace(/\s+/g, " ").trim().replace(/\s+\d+\s*$/, "").trim();
            }
            function isNoise(t) {
              return !t || t.length < 2 || t.length > 60 || NOISE.has(t) || /^\d+$/.test(t);
            }

            const SIDEBAR_RIGHT = 230;
            const wait = ms => new Promise(r => setTimeout(r, ms));

            // ── Buscar el contenedor con scroll horizontal del tablero ────────
            function findHScroller() {
              // Selectores específicos de Notion primero
              for (const sel of [
                ".notion-board-view",
                '[class*="boardView"]',
                '[data-block-view-type="board"]',
              ]) {
                const el = document.querySelector(sel);
                if (el && el.scrollWidth > el.clientWidth + 100) return el;
              }
              // Genérico: elemento con overflow-x scroll/auto más ancho visible
              let best = null;
              document.querySelectorAll("*").forEach(el => {
                if (el.scrollWidth <= el.clientWidth + 100) return;
                const r = el.getBoundingClientRect();
                if (r.width < 400 || r.top < 40 || r.top > 500) return;
                const ox = window.getComputedStyle(el).overflowX;
                if (ox !== "scroll" && ox !== "auto") return;
                if (!best || el.scrollWidth > best.scrollWidth) best = el;
              });
              return best;
            }

            // ── Recopilar nodos de texto visibles en el viewport actual ───────
            // absX = scrollLeft + rect.left → posición absoluta dentro del tablero
            function snapshot(scrollLeft) {
              const items = [];
              const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
              let tn;
              while ((tn = tw.nextNode())) {
                const t = clean(tn.textContent);
                if (isNoise(t)) continue;
                const el = tn.parentElement;
                if (!el) continue;
                const r = el.getBoundingClientRect();
                if (r.width < 4 || r.height < 4) continue;
                if (r.left < SIDEBAR_RIGHT || r.top < 55) continue;
                items.push({ t, absX: scrollLeft + r.left, y: r.top });
              }
              return items;
            }

            // ── Recorrer el tablero de izquierda a derecha ───────────────────
            // allItems: clave = texto, valor = {t, absX, y}
            // Se conserva la primera aparición (la más a la izquierda).
            const allItems = new Map();

            const scroller = findHScroller();
            if (scroller) {
              const maxScroll = scroller.scrollWidth - scroller.clientWidth;
              const STEP = Math.max(250, Math.floor(scroller.clientWidth * 0.55));

              // Ir al inicio para no perder las columnas izquierdas
              scroller.scrollLeft = 0;
              await wait(350);

              let prevScroll = -1;
              while (true) {
                const cur = scroller.scrollLeft;
                snapshot(cur).forEach(item => {
                  if (!allItems.has(item.t)) allItems.set(item.t, item);
                });
                if (cur >= maxScroll - 5 || cur === prevScroll) break;
                prevScroll = cur;
                scroller.scrollLeft = cur + STEP;
                await wait(350);
              }
            } else {
              // Sin scroll horizontal → capturar lo que haya visible
              snapshot(0).forEach(item => {
                if (!allItems.has(item.t)) allItems.set(item.t, item);
              });
            }

            const textItems = [...allItems.values()];

            // ── Detección de la fila de cabeceras ────────────────────────────
            // Agrupamos por franja Y de 30px; la primera franja con ≥ 3 textos
            // distintos distribuidos > 150px horizontalmente = fila de nombres.
            const yBuckets = new Map();
            textItems.forEach(it => {
              const key = Math.round(it.y / 30) * 30;
              if (!yBuckets.has(key)) yBuckets.set(key, []);
              yBuckets.get(key).push(it);
            });

            const sortedBands = [...yBuckets.entries()].sort((a, b) => a[0] - b[0]);
            let headerItems = null;
            for (const [, items] of sortedBands) {
              const distinct = [...new Map(items.map(i => [i.t, i])).values()];
              if (distinct.length < 3) continue;
              const xs = distinct.map(i => i.absX);
              if (Math.max(...xs) - Math.min(...xs) < 150) continue;
              headerItems = distinct;
              break;
            }

            if (headerItems) {
              return headerItems
                .sort((a, b) => a.absX - b.absX)
                .map(i => i.t);
            }

            // ── FALLBACK: avatares agrupados por Y ────────────────────────────
            const seen    = new Set();
            const results = [];

            function add(raw, x) {
              const t = clean(raw);
              if (isNoise(t) || seen.has(t)) return;
              seen.add(t); results.push({ name: t, x: x || 0 });
            }

            const avatars = [];
            document.querySelectorAll("img").forEach(img => {
              const r = img.getBoundingClientRect();
              if (r.width < 10 || r.width > 42 || r.height < 10 || r.height > 42) return;
              if (r.left < SIDEBAR_RIGHT || r.top < 50) return;
              avatars.push({ el: img, r });
            });
            document.querySelectorAll("div, span").forEach(el => {
              const r = el.getBoundingClientRect();
              if (r.width < 18 || r.width > 44 || Math.abs(r.width - r.height) > 8) return;
              if (r.left < SIDEBAR_RIGHT || r.top < 50) return;
              const txt = el.textContent.trim();
              if (txt.length <= 2 && /^[A-ZÁÉÍÓÚÜÑ]/i.test(txt)) avatars.push({ el, r });
            });

            const avBuckets = new Map();
            avatars.forEach(av => {
              const key = Math.round(av.r.top / 30) * 30;
              if (!avBuckets.has(key)) avBuckets.set(key, []);
              avBuckets.get(key).push(av);
            });
            const headerRow = [...avBuckets.values()]
              .filter(g => g.length >= 2)
              .sort((a, b) => b.length - a.length)[0] || [];
            headerRow.sort((a, b) => a.r.left - b.r.left);

            headerRow.forEach(av => {
              if (av.el.tagName === "IMG") {
                const label = av.el.getAttribute("aria-label") ||
                              av.el.getAttribute("alt") ||
                              av.el.getAttribute("title");
                if (label && label.length > 1 && label.toLowerCase() !== "notion avatar") {
                  add(label, av.r.left); return;
                }
              }
              let el = av.el.parentElement;
              for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
                for (const child of el.childNodes) {
                  if (child.nodeType === Node.TEXT_NODE) {
                    const t = clean(child.textContent);
                    if (!isNoise(t)) { add(t, av.r.left); return; }
                  }
                }
                const line = clean((el.innerText || "").split("\n")[0]);
                if (!isNoise(line) && line.length < 45) { add(line, av.r.left); return; }
              }
            });

            // Fallback final: role="columnheader"
            if (results.length === 0) {
              document.querySelectorAll('[role="columnheader"]').forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.left >= SIDEBAR_RIGHT) add(el.textContent, r.left);
              });
            }

            return results.sort((a, b) => a.x - b.x).map(r => r.name);
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
          timerState = { ...DEFAULT_STATE, participants, running: true, startTime: Date.now() };
          saveState();
          sendResponse({ success: true, participants });
          break;
        }

        case "FETCH_PARTICIPANTS": {
          const participants = await fetchParticipants();
          timerState = { ...DEFAULT_STATE, participants, running: true, startTime: Date.now() };
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
          timerState.running   = true;
          timerState.startTime = Date.now();
          timerState.elapsed   = 0;
          saveState();
          sendResponse({ timerState });
          break;

        case "NEXT_PERSON":
        case "NEXT_AND_START": {
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
            timerState.elapsed      = 0;
            timerState.startTime    = Date.now();
            timerState.running      = true;
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
              timerState.elapsed      = 0;
              timerState.startTime    = Date.now();
              timerState.running      = true;
            }
          }
          saveState();
          sendResponse({ timerState });
          break;
        }

        case "JUMP_TO":
        case "JUMP_AND_START": {
          const idx = msg.index;
          if (idx >= 0 && idx < timerState.participants.length) {
            timerState.currentIndex = idx;
            timerState.elapsed      = 0;
            timerState.startTime    = Date.now();
            timerState.running      = true;
            saveState();
          }
          sendResponse({ timerState });
          break;
        }

        case "SHUFFLE_PARTICIPANTS": {
          const arr = [...timerState.participants];
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          timerState.participants = arr;
          timerState.currentIndex = 0;
          timerState.elapsed      = 0;
          timerState.startTime    = Date.now();
          timerState.running      = true;
          timerState.absent       = [];
          timerState.done         = [];
          saveState();
          sendResponse({ timerState });
          break;
        }

        case "TOGGLE_DONE": {
          const idx  = msg.index;
          const done = timerState.done ? [...timerState.done] : [];
          const pos  = done.indexOf(idx);
          if (pos === -1) done.push(idx);
          else done.splice(pos, 1);
          timerState.done = done;
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
