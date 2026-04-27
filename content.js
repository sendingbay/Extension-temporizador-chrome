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

// Devuelve el contenedor scrollable del sidebar de Notion
function getNotionSidebar() {
  return (
    document.querySelector(".notion-sidebar-container .notion-scroller.vertical") ||
    document.querySelector(".notion-sidebar .notion-scroller.vertical") ||
    document.querySelector(".notion-sidebar-container") ||
    document.querySelector(".notion-sidebar") ||
    null
  );
}

function injectTimerUI() {
  // Evitar duplicados
  if (document.getElementById(TIMER_BUTTON_ID)) return;

  const sidebar = getNotionSidebar();
  if (!sidebar) return; // Se reintentará desde el MutationObserver

  // --- Ítem del sidebar (estilo nativo de Notion) ---
  const item = document.createElement("div");
  item.id = TIMER_BUTTON_ID;
  Object.assign(item.style, {
    display:      "flex",
    alignItems:   "center",
    gap:          "8px",
    padding:      "6px 12px",
    margin:       "2px 4px",
    borderRadius: "6px",
    cursor:       "pointer",
    fontSize:     "14px",
    fontWeight:   "500",
    color:        "inherit",
    userSelect:   "none",
    transition:   "background 0.1s",
  });

  const icon = document.createElement("span");
  icon.textContent = "⏱";
  icon.style.fontSize = "16px";

  const label = document.createElement("span");
  label.id = "daily-timer-label";
  label.textContent = "Iniciar Daily";

  item.appendChild(icon);
  item.appendChild(label);

  item.addEventListener("mouseenter", () => {
    item.style.background = "rgba(55, 53, 47, 0.08)";
  });
  item.addEventListener("mouseleave", () => {
    item.style.background = "transparent";
  });
  item.addEventListener("click", onTimerButtonClick);

  // Insertar antes del último hijo para quedar cerca del fondo pero no al final del todo
  const lastChild = sidebar.lastElementChild;
  if (lastChild) {
    sidebar.insertBefore(item, lastChild);
  } else {
    sidebar.appendChild(item);
  }

  // --- Panel de cuenta regresiva (overlay flotante sobre el contenido) ---
  const display = document.createElement("div");
  display.id = TIMER_DISPLAY_ID;
  Object.assign(display.style, {
    position:      "fixed",
    bottom:        "24px",
    left:          "50%",
    transform:     "translateX(-50%)",
    zIndex:        "99999",
    padding:       "14px 28px",
    background:    "#1e1e1e",
    color:         "#fff",
    borderRadius:  "14px",
    fontSize:      "36px",
    fontWeight:    "700",
    fontFamily:    "ui-monospace, monospace",
    boxShadow:     "0 6px 24px rgba(0,0,0,0.45)",
    display:       "none",
    minWidth:      "130px",
    textAlign:     "center",
    letterSpacing: "3px",
    transition:    "background 0.4s",
  });

  document.body.appendChild(display);
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

  const label  = document.getElementById("daily-timer-label");
  if (label)   label.textContent       = "⏹ Detener";
  if (display) display.style.display   = "block";

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

  const label2  = document.getElementById("daily-timer-label");
  if (label2)   label2.textContent    = "Iniciar Daily";
  if (display)  display.style.display = "none";
}

function onTimerEnd() {
  const display = document.getElementById(TIMER_DISPLAY_ID);
  const btn     = document.getElementById(TIMER_BUTTON_ID);

  if (display) {
    display.textContent      = "✅ Listo";
    display.style.background = "#0f9d58";
  }
  const label3 = document.getElementById("daily-timer-label");
  if (label3) label3.textContent = "Iniciar Daily";

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
  // Intentar inmediatamente si el sidebar ya está en el DOM
  if (getNotionSidebar()) {
    injectTimerUI();
    return;
  }

  // Notion monta el sidebar de forma asíncrona; observar hasta que aparezca
  const observer = new MutationObserver((_mutations, obs) => {
    if (getNotionSidebar()) {
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

