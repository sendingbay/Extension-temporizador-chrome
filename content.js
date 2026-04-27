// ==========================
// 🧩 SCRAPER DE DOM — Notion
// ==========================
// Este script se inyecta en páginas de notion.so.
// Escucha mensajes del background y devuelve los nombres
// extraídos de la vista de base de datos activa.

// Textos de UI de Notion que deben ignorarse siempre
const UI_NOISE = new Set([
  // Inglés
  "New", "Filter", "Sort", "Search", "Group", "Properties",
  "Share", "Export", "Add a page", "Calculate", "Untitled",
  "No assignee", "Empty", "Count", "Open", "Delete", "Duplicate",
  "Skip to content", "···", "...",
  // Español
  "Sin título", "Ir al contenido", "Sin asignar", "Vacío",
  "Nueva página", "+ Nueva página", "Nuevo", "Abrir", "Eliminar",
  "Filtrar", "Ordenar", "Agrupar", "Propiedades", "Compartir",
  "Añadir una página", "Calcular",
]);

function isNoise(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 2 || t.length > 80) return true;
  if (UI_NOISE.has(t)) return true;
  if (/^\d+$/.test(t)) return true;            // solo números (recuentos)
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return true; // fechas
  return false;
}

function extractNamesFromNotion() {
  const results = [];
  const seen    = new Set();

  function add(rawText) {
    // Limpiar espacios y quitar números de recuento al final (ej. "Ana Karina 3")
    let t = rawText?.replace(/\s+/g, " ").trim();
    // Quitar sufijo numérico que Notion añade en cabeceras de columna ("Nombre 5")
    t = t?.replace(/\s+\d+\s*$/, "").trim();
    if (isNoise(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
    results.push(t);
  }

  // Área principal de contenido (excluye sidebar y navegación)
  const main = document.querySelector(
    ".notion-frame, .notion-page-content, [data-block-id], main"
  ) || document.body;

  // ── Estrategia 0: Cabeceras de columna del tablero (board agrupado por persona)
  // Notion usa role="columnheader" para las cabeceras de cada columna del kanban.
  const columnHeaders = main.querySelectorAll('[role="columnheader"]');
  if (columnHeaders.length > 0) {
    columnHeaders.forEach(el => add(el.textContent));
  }

  // ── Estrategia 0b: Cabeceras de columna via data-column-id o similares ─────
  // En algunas versiones de Notion las columnas del board no tienen role="columnheader"
  // sino que son divs con atributos de data. Buscamos dentro del board container.
  if (results.length === 0) {
    // Notion suele envolver el board en un elemento con clase "notion-board-view"
    // o un contenedor scrollable. Buscamos los textos de encabezado de columna
    // que contienen el nombre del grupo (persona).
    const boardGroups = main.querySelectorAll(
      '[data-block-id] > [style*="flex-direction: column"] > [style*="overflow"],' +
      '.notion-board-view [data-column-id],' +
      '[role="grid"] > [role="row"]:first-child [role="columnheader"],' +
      '[role="grid"] > [role="rowgroup"]:first-child [role="columnheader"]'
    );
    boardGroups.forEach(el => add(el.textContent));
  }

  // ── Estrategia 1: Vista tabla ────────────────────────────────
  // Filtramos filas que tengan al menos 2 celdas (evita el skip-nav row)
  if (results.length === 0) {
    const rows = main.querySelectorAll('[role="row"]');
    rows.forEach(row => {
      const cells = row.querySelectorAll('[role="gridcell"]');
      if (cells.length >= 2) {
        // La primera celda es el título/nombre
        add(cells[0].textContent);
      }
    });
  }

  // ── Estrategia 2: Vista lista / galería ─────────────────────
  if (results.length === 0) {
    main.querySelectorAll('[role="link"]').forEach(el => {
      const first = el.firstElementChild;
      add(first ? first.textContent : el.textContent);
    });
  }

  // ── Estrategia 3: Fallback — elementos editables de una línea ──
  if (results.length === 0) {
    main.querySelectorAll("[contenteditable='true']").forEach(el => {
      const t = el.textContent?.trim();
      if (t && !t.includes("\n")) add(t);
    });
  }

  return results;
}

// ── Escuchar mensajes del background/popup ───────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_DOM_PARTICIPANTS") {
    sendResponse({ names: extractNamesFromNotion() });
  }
  return true;
});

// ==========================
// ⏱ TIMER FLOTANTE — Notion
// ==========================

const TIMER_BUTTON_ID  = "daily-timer-btn";
const TIMER_DISPLAY_ID = "daily-timer-display";
const TIMER_DURATION   = 2 * 60; // 2 minutos en segundos

let timerInterval = null;
let secondsLeft   = TIMER_DURATION;

function injectTimerUI() {
  // Evitar duplicados
  if (document.getElementById(TIMER_BUTTON_ID)) return;

  // --- Botón flotante ---
  const btn = document.createElement("button");
  btn.id = TIMER_BUTTON_ID;
  btn.textContent = "⏱ Iniciar Daily";
  Object.assign(btn.style, {
    position:    "fixed",
    bottom:      "24px",
    right:       "24px",
    zIndex:      "99999",
    padding:     "10px 16px",
    background:  "#2eaadc",
    color:       "#fff",
    border:      "none",
    borderRadius:"8px",
    fontSize:    "14px",
    fontWeight:  "600",
    cursor:      "pointer",
    boxShadow:   "0 4px 12px rgba(0,0,0,0.25)",
    fontFamily:  "ui-sans-serif, system-ui, sans-serif",
    transition:  "background 0.2s",
    userSelect:  "none",
  });

  // --- Panel de cuenta regresiva ---
  const display = document.createElement("div");
  display.id = TIMER_DISPLAY_ID;
  Object.assign(display.style, {
    position:      "fixed",
    bottom:        "74px",
    right:         "24px",
    zIndex:        "99999",
    padding:       "12px 20px",
    background:    "#1e1e1e",
    color:         "#fff",
    borderRadius:  "12px",
    fontSize:      "28px",
    fontWeight:    "700",
    fontFamily:    "ui-monospace, monospace",
    boxShadow:     "0 4px 16px rgba(0,0,0,0.4)",
    display:       "none",
    minWidth:      "110px",
    textAlign:     "center",
    letterSpacing: "2px",
    transition:    "background 0.4s",
  });

  btn.addEventListener("click", onTimerButtonClick);

  document.body.appendChild(display);
  document.body.appendChild(btn);
}

function onTimerButtonClick() {
  if (timerInterval) {
    stopTimer();
  } else {
    startTimer();
  }
}

function startTimer() {
  secondsLeft = TIMER_DURATION;

  const btn     = document.getElementById(TIMER_BUTTON_ID);
  const display = document.getElementById(TIMER_DISPLAY_ID);

  if (btn)     btn.textContent        = "⏹ Detener";
  if (display) display.style.display  = "block";

  // Leer tareas/texto visible del DOM y mostrar en consola
  logVisibleTasks();

  updateDisplay();

  timerInterval = setInterval(() => {
    secondsLeft--;
    updateDisplay();

    if (secondsLeft <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      onTimerEnd();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  secondsLeft   = TIMER_DURATION;

  const btn     = document.getElementById(TIMER_BUTTON_ID);
  const display = document.getElementById(TIMER_DISPLAY_ID);

  if (btn)     btn.textContent       = "⏱ Iniciar Daily";
  if (display) display.style.display = "none";
}

function onTimerEnd() {
  const display = document.getElementById(TIMER_DISPLAY_ID);
  const btn     = document.getElementById(TIMER_BUTTON_ID);

  if (display) {
    display.textContent      = "✅ Listo";
    display.style.background = "#0f9d58";
  }
  if (btn) btn.textContent = "⏱ Iniciar Daily";

  // Ocultar panel tras 3 segundos y restaurar color
  setTimeout(() => {
    if (display) {
      display.style.display    = "none";
      display.style.background = "#1e1e1e";
    }
  }, 3000);
}

function updateDisplay() {
  const display = document.getElementById(TIMER_DISPLAY_ID);
  if (!display) return;

  const m = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const s = String(secondsLeft % 60).padStart(2, "0");
  display.textContent = `${m}:${s}`;

  // Alerta visual cuando quedan ≤ 30 segundos
  display.style.background = secondsLeft <= 30 ? "#d93025" : "#1e1e1e";
}

function logVisibleTasks() {
  const tasks = extractNamesFromNotion();
  if (tasks.length > 0) {
    console.group("[Daily Timer] Tareas/elementos visibles en Notion:");
    tasks.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    console.groupEnd();
  } else {
    console.log("[Daily Timer] No se encontraron tareas visibles en esta vista.");
  }
}

// ── Inyección con MutationObserver (Notion carga dinámicamente) ──
function waitForNotionAndInject() {
  // Notion monta su árbol de forma asíncrona; intentar primero de inmediato.
  if (document.querySelector(".notion-app-inner, .notion-frame, #notion-app")) {
    injectTimerUI();
    return;
  }

  const observer = new MutationObserver((_mutations, obs) => {
    if (document.querySelector(".notion-app-inner, .notion-frame, #notion-app")) {
      obs.disconnect();
      injectTimerUI();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Doble verificación en runtime: solo ejecutar dentro de notion.so
if (location.hostname.endsWith("notion.so")) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForNotionAndInject);
  } else {
    waitForNotionAndInject();
  }
}

