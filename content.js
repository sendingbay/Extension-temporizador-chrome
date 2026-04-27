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
// ⏱ PANEL DAILY — Notion
// ==========================

const TIMER_BUTTON_ID = "daily-timer-btn";
const PANEL_ID        = "daily-timer-panel";

let panelVisible = false;
let hasWarned    = false;
let panelAudioCtx = null;

// ── Audio ────────────────────────────────────────────────────
function getPanelAudioCtx() {
  if (!panelAudioCtx) panelAudioCtx = new AudioContext();
  return panelAudioCtx;
}
function panelBeep(freq = 880, duration = 200, volume = 0.3) {
  try {
    const ctx  = getPanelAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration / 1000);
  } catch (_) { /* audio no disponible */ }
}

// ── Comunicación con background.js ───────────────────────────
function sendBg(type, data = {}) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ type, ...data }, response => resolve(response))
  );
}

// ── Escape HTML seguro ────────────────────────────────────────
function escHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Selector del sidebar de Notion ───────────────────────────
function getNotionSidebar() {
  return (
    document.querySelector(".notion-sidebar-container .notion-scroller.vertical") ||
    document.querySelector(".notion-sidebar .notion-scroller.vertical") ||
    document.querySelector(".notion-sidebar-container") ||
    document.querySelector(".notion-sidebar") ||
    null
  );
}

// ── CSS del panel ─────────────────────────────────────────────
const PANEL_CSS = `
  #daily-timer-panel * { box-sizing: border-box; margin: 0; padding: 0; }
  #dp-list .dp-item {
    display: flex; align-items: center; gap: 8px; padding: 5px 8px;
    border-radius: 6px; cursor: pointer; transition: background .1s;
  }
  #dp-list .dp-item:hover  { background: rgba(255,255,255,.06); }
  #dp-list .dp-item.active { background: rgba(0,82,204,.15); }
  #dp-list .dp-item.done   { opacity: .45; }
  #dp-list .dp-item.absent { opacity: .3; text-decoration: line-through; }
  #dp-list .dp-avatar {
    width: 26px; height: 26px; border-radius: 50%; background: #0052cc;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: #fff; flex-shrink: 0;
  }
  #dp-list .dp-pname  { flex: 1; font-size: 13px; color: #ddd; }
  #dp-list .dp-ptasks { font-size: 11px; color: #4da6ff; }
  #dp-list .dp-absent-btn {
    background: none; border: none; color: #555; cursor: pointer;
    font-size: 12px; padding: 2px 5px; border-radius: 4px;
  }
  #dp-list .dp-absent-btn:hover { color: #fff; background: rgba(255,255,255,.1); }
  #dp-timer-wrap.warning  #dp-timer { color: #ff5630 !important; animation: dp-pulse .5s ease-in-out infinite alternate; }
  #dp-timer-wrap.finished #dp-timer { color: #36b37e !important; animation: none; }
  @keyframes dp-pulse { from { opacity: 1; } to { opacity: .45; } }
`;

function injectPanelCSS() {
  if (document.getElementById("daily-panel-css")) return;
  const style = document.createElement("style");
  style.id = "daily-panel-css";
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

// ── Construcción del HTML del panel ──────────────────────────
function buildPanelHTML() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 14px;background:#16213e;border-bottom:1px solid #0f3460;">
      <span style="font-size:13px;font-weight:600;color:#4da6ff;letter-spacing:.5px;">⏱ Daily Timer</span>
      <button id="dp-close" style="background:none;border:none;color:#888;cursor:pointer;
              font-size:16px;padding:2px 6px;border-radius:4px;" title="Cerrar">✕</button>
    </div>
    <div style="padding:14px 14px 6px;text-align:center;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:4px;">En turno</div>
      <div id="dp-name"    style="font-size:20px;font-weight:700;color:#fff;">—</div>
      <div id="dp-tasks"   style="font-size:12px;color:#4da6ff;margin-top:2px;"></div>
      <div id="dp-counter" style="font-size:11px;color:#555;margin-top:2px;"></div>
    </div>
    <div id="dp-timer-wrap" style="text-align:center;padding:4px 14px 10px;">
      <div id="dp-timer" style="font-size:56px;font-weight:700;letter-spacing:-2px;
           color:#fff;font-family:'Courier New',monospace;line-height:1;transition:color .3s;">
        2:00
      </div>
    </div>
    <div style="display:flex;gap:8px;padding:0 14px 10px;">
      <button id="dp-play"  style="flex:2;padding:9px;border:none;border-radius:8px;
              background:#0052cc;color:#fff;cursor:pointer;font-size:20px;">▶</button>
      <button id="dp-reset" style="flex:1;padding:9px;border:none;border-radius:8px;
              background:#252540;color:#aaa;cursor:pointer;font-size:18px;" title="Reiniciar">↺</button>
      <button id="dp-next"  style="flex:1;padding:9px;border:none;border-radius:8px;
              background:#252540;color:#aaa;cursor:pointer;font-size:18px;" title="Siguiente">→</button>
    </div>
    <div id="dp-status" style="text-align:center;font-size:12px;color:#888;
         padding:0 14px 6px;min-height:18px;"></div>
    <div style="height:1px;background:#0f3460;margin:0 14px;"></div>
    <div style="display:flex;gap:6px;padding:8px 14px;">
      <button id="dp-fetch-dom" style="flex:1;padding:7px 4px;border:none;border-radius:6px;
              background:#252540;color:#ccc;cursor:pointer;font-size:12px;">📄 Desde página</button>
      <button id="dp-fetch-api" style="flex:1;padding:7px 4px;border:none;border-radius:6px;
              background:#252540;color:#ccc;cursor:pointer;font-size:12px;">↻ API</button>
    </div>
    <div id="dp-list" style="max-height:180px;overflow-y:auto;padding:0 14px 12px;"></div>
  `;
}

// ── Inyección del ítem del sidebar + panel ────────────────────
function injectTimerUI() {
  if (document.getElementById(TIMER_BUTTON_ID)) return;

  const sidebar = getNotionSidebar();
  if (!sidebar) return;

  // Ítem del sidebar (estilo nativo Notion)
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
  label.textContent = "Daily Timer";

  item.appendChild(icon);
  item.appendChild(label);
  item.addEventListener("mouseenter", () => { item.style.background = "rgba(55,53,47,0.08)"; });
  item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
  item.addEventListener("click", () => togglePanel());

  // Posición: justo debajo de "Eeb eComm - Encuestas"
  const TARGET_LABEL = "Eeb eComm - Encuestas";
  const allSidebarItems = Array.from(sidebar.querySelectorAll("*"));
  const anchor = allSidebarItems.find(
    el => el.children.length === 0 && el.textContent.trim() === TARGET_LABEL
  );
  const anchorRow = anchor
    ? anchor.closest("[data-block-id], [role='treeitem'], div[style]") || anchor.parentElement
    : null;

  if (anchorRow && anchorRow.parentElement === sidebar) {
    anchorRow.insertAdjacentElement("afterend", item);
  } else if (anchorRow) {
    let node = anchorRow;
    while (node.parentElement && node.parentElement !== sidebar) node = node.parentElement;
    node.insertAdjacentElement("afterend", item);
  } else {
    const lastChild = sidebar.lastElementChild;
    if (lastChild) sidebar.insertBefore(item, lastChild);
    else sidebar.appendChild(item);
  }

  // Panel flotante junto al sidebar
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = buildPanelHTML();
  Object.assign(panel.style, {
    position:     "fixed",
    bottom:       "24px",
    left:         "240px",
    zIndex:       "99999",
    width:        "320px",
    background:   "#1a1a2e",
    color:        "#e0e0e0",
    borderRadius: "12px",
    boxShadow:    "0 8px 32px rgba(0,0,0,0.55)",
    fontFamily:   "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize:     "14px",
    display:      "none",
    overflow:     "hidden",
  });

  document.body.appendChild(panel);
  injectPanelCSS();
  bindPanelEvents();
  setInterval(updatePanel, 200);
}

// ── Eventos del panel ─────────────────────────────────────────
function bindPanelEvents() {
  document.getElementById("dp-close").addEventListener("click", () => togglePanel(false));

  document.getElementById("dp-play").addEventListener("click", async () => {
    if (panelAudioCtx?.state === "suspended") panelAudioCtx.resume();
    await sendBg("START_PAUSE");
  });

  document.getElementById("dp-reset").addEventListener("click", async () => {
    hasWarned = false;
    await sendBg("RESET_TIMER");
  });

  document.getElementById("dp-next").addEventListener("click", async () => {
    hasWarned = false;
    await sendBg("NEXT_PERSON");
  });

  document.getElementById("dp-fetch-dom").addEventListener("click", async function () {
    this.disabled = true;
    this.textContent = "Leyendo…";
    setDpStatus("Leyendo la página de Notion…");
    const res = await sendBg("FETCH_FROM_DOM");
    this.disabled = false;
    this.textContent = "📄 Desde página";
    if (res?.success) {
      hasWarned = false;
      const n = res.participants.length;
      setDpStatus(`✓ ${n} participante${n !== 1 ? "s" : ""} cargado${n !== 1 ? "s" : ""}`, "success");
      setTimeout(() => setDpStatus(""), 3000);
    } else {
      setDpStatus(res?.error || "Error al leer la página", "error");
    }
  });

  document.getElementById("dp-fetch-api").addEventListener("click", async function () {
    this.disabled = true;
    this.textContent = "Cargando…";
    setDpStatus("Conectando con Notion…");
    const res = await sendBg("FETCH_PARTICIPANTS");
    this.disabled = false;
    this.textContent = "↻ API";
    if (res?.success) {
      hasWarned = false;
      const n = res.participants.length;
      setDpStatus(`✓ ${n} participante${n !== 1 ? "s" : ""}`, "success");
      setTimeout(() => setDpStatus(""), 3000);
    } else {
      setDpStatus(res?.error || "Error al conectar", "error");
    }
  });
}

function setDpStatus(msg, type = "") {
  const el = document.getElementById("dp-status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === "error" ? "#ff5630" : type === "success" ? "#36b37e" : "#888";
}

function togglePanel(forceState) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  panelVisible = typeof forceState === "boolean" ? forceState : !panelVisible;
  panel.style.display = panelVisible ? "block" : "none";
}

// ── Bucle de actualización (200 ms) ──────────────────────────
async function updatePanel() {
  if (!panelVisible) return;
  const res   = await sendBg("GET_STATE");
  const state = res?.timerState;
  if (!state) return;

  // Calcular tiempo restante
  let remaining = state.duration - state.elapsed;
  if (state.running && state.startTime) remaining -= (Date.now() - state.startTime);
  remaining = Math.max(0, remaining);

  const totalSecs = Math.ceil(remaining / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;

  const timerEl = document.getElementById("dp-timer");
  const wrapEl  = document.getElementById("dp-timer-wrap");
  if (timerEl) timerEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

  if (wrapEl) {
    const inProgress = state.running || state.elapsed > 0;
    if (totalSecs === 0 && inProgress) {
      wrapEl.classList.remove("warning"); wrapEl.classList.add("finished");
    } else if (totalSecs <= 10 && totalSecs > 0 && inProgress) {
      wrapEl.classList.add("warning"); wrapEl.classList.remove("finished");
      if (!hasWarned) {
        hasWarned = true;
        panelBeep(880, 250);
        setTimeout(() => panelBeep(880, 250), 350);
      }
    } else {
      wrapEl.classList.remove("warning", "finished");
    }
  }

  if (state.elapsed === 0 && !state.running) hasWarned = false;

  const playBtn = document.getElementById("dp-play");
  if (playBtn) playBtn.textContent = state.running ? "⏸" : "▶";

  const participants = state.participants || [];
  const absent       = state.absent || [];
  const current      = participants[state.currentIndex] || null;

  const nameEl = document.getElementById("dp-name");
  if (nameEl) nameEl.textContent = current ? current.name : "—";

  const tasksEl = document.getElementById("dp-tasks");
  if (tasksEl) tasksEl.textContent = current
    ? `${current.taskCount} tarea${current.taskCount !== 1 ? "s" : ""}` : "";

  const activeTotal = participants.filter((_, i) => !absent.includes(i)).length;
  const activeDone  = participants.filter((_, i) => !absent.includes(i) && i < state.currentIndex).length;
  const counterEl   = document.getElementById("dp-counter");
  if (counterEl && participants.length > 0) {
    const absentCount = absent.length;
    let txt = `${activeDone + 1} de ${activeTotal}`;
    if (absentCount > 0) txt += ` · ${absentCount} ausente${absentCount !== 1 ? "s" : ""}`;
    counterEl.textContent = txt;
  }

  renderParticipantList(participants, state.currentIndex, absent);
}

// ── Lista de participantes ────────────────────────────────────
function renderParticipantList(participants, currentIndex, absent) {
  const container = document.getElementById("dp-list");
  if (!container) return;

  if (!participants || participants.length === 0) {
    container.innerHTML =
      '<div style="color:#555;font-size:12px;text-align:center;padding:8px 0;">' +
      'Carga los participantes con los botones de arriba.</div>';
    return;
  }

  container.innerHTML = participants.map((p, i) => {
    const isAbsent = absent.includes(i);
    const cls = [
      "dp-item",
      i === currentIndex && !isAbsent ? "active" : "",
      i < currentIndex  && !isAbsent ? "done"   : "",
      isAbsent ? "absent" : "",
    ].filter(Boolean).join(" ");
    const absentTitle = isAbsent ? "Marcar presente" : "Marcar ausente";
    const absentIcon  = isAbsent ? "✓" : "✕";
    return `
      <div class="${cls}" data-index="${i}">
        <div class="dp-avatar">${escHtml(p.name.charAt(0).toUpperCase())}</div>
        <span class="dp-pname">${escHtml(p.name)}</span>
        <span class="dp-ptasks">${p.taskCount} t.</span>
        <button class="dp-absent-btn" data-index="${i}" title="${absentTitle}">${absentIcon}</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".dp-item").forEach(el => {
    el.addEventListener("pointerdown", async e => {
      if (e.target.classList.contains("dp-absent-btn")) return;
      hasWarned = false;
      await sendBg("JUMP_TO", { index: parseInt(el.dataset.index, 10) });
    });
  });

  container.querySelectorAll(".dp-absent-btn").forEach(btn => {
    btn.addEventListener("pointerdown", async e => {
      e.stopPropagation();
      hasWarned = false;
      await sendBg("TOGGLE_ABSENT", { index: parseInt(btn.dataset.index, 10) });
    });
  });
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
  if (getNotionSidebar()) {
    injectTimerUI();
    return;
  }
  const observer = new MutationObserver((_mutations, obs) => {
    if (getNotionSidebar()) {
      obs.disconnect();
      injectTimerUI();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Solo ejecutar dentro de notion.so
if (location.hostname.endsWith("notion.so")) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForNotionAndInject);
  } else {
    waitForNotionAndInject();
  }
}

