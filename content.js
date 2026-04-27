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

  #dp-list::-webkit-scrollbar { width: 4px; }
  #dp-list::-webkit-scrollbar-track { background: transparent; }
  #dp-list::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }

  #dp-play:hover      { background: #2563eb !important; }
  #dp-reset:hover     { background: #263348 !important; color: #e2e8f0 !important; }
  #dp-next:hover      { background: #263348 !important; color: #e2e8f0 !important; }
  #dp-fetch-dom:hover { background: #263348 !important; color: #e2e8f0 !important; }
  #dp-shuffle:hover   { background: #263348 !important; color: #e2e8f0 !important; }
  #dp-close:hover     { color: #e2e8f0 !important; background: rgba(255,255,255,.08) !important; }

  #dp-list .dp-item {
    display: flex; align-items: center; gap: 7px;
    padding: 7px 10px; border-radius: 8px; cursor: pointer;
    transition: background .15s; border-left: 3px solid transparent;
    margin-bottom: 2px;
  }
  #dp-list .dp-item:hover  { background: rgba(255,255,255,.05); }
  #dp-list .dp-item.active { background: rgba(59,130,246,.15); border-left-color: #3b82f6; }
  #dp-list .dp-item.done   { background: rgba(34,197,94,.07);  border-left-color: #22c55e; }
  #dp-list .dp-item.absent { opacity: .3; border-left-color: transparent; }
  #dp-list .dp-item.absent .dp-pname { text-decoration: line-through; }

  #dp-list .dp-avatar {
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: #fff; flex-shrink: 0;
    background: #475569;
  }
  #dp-list .dp-item.active .dp-avatar { background: #3b82f6; }
  #dp-list .dp-item.done   .dp-avatar { background: #16a34a; }

  #dp-list .dp-pname  { flex: 1; font-size: 13px; color: #cbd5e1; line-height: 1.3; }
  #dp-list .dp-item.done   .dp-pname { color: #86efac; }
  #dp-list .dp-item.active .dp-pname { color: #f1f5f9; font-weight: 600; }
  #dp-list .dp-ptasks { font-size: 10px; color: #475569; white-space: nowrap; }

  #dp-list .dp-done-btn, #dp-list .dp-absent-btn {
    background: none; border: none; cursor: pointer;
    font-size: 12px; padding: 2px 4px; border-radius: 4px;
    transition: color .15s, background .15s; flex-shrink: 0; color: #334155;
  }
  #dp-list .dp-done-btn:hover   { color: #4ade80; background: rgba(74,222,128,.12); }
  #dp-list .dp-absent-btn:hover { color: #f87171; background: rgba(248,113,113,.12); }
  #dp-list .dp-item.done   .dp-done-btn   { color: #22c55e; }
  #dp-list .dp-item.absent .dp-absent-btn { color: #f87171; }

  #dp-timer-wrap.warning  #dp-timer { color: #f59e0b !important; animation: dp-pulse .5s ease-in-out infinite alternate; }
  #dp-timer-wrap.finished #dp-timer { color: #22c55e !important; animation: none; }
  @keyframes dp-pulse { from { opacity: 1; } to { opacity: .4; } }
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
                padding:11px 14px;background:#1e293b;border-bottom:1px solid #263348;">
      <div style="display:flex;align-items:center;gap:7px;">
        <span style="font-size:15px;line-height:1;">⏱</span>
        <span style="font-size:13px;font-weight:700;color:#e2e8f0;letter-spacing:.3px;">Daily Timer</span>
      </div>
      <button id="dp-close" style="background:none;border:none;color:#475569;cursor:pointer;
              font-size:14px;padding:3px 7px;border-radius:5px;transition:color .15s;" title="Cerrar">✕</button>
    </div>
    <div style="padding:12px 14px 6px;background:#0f172a;">
      <div style="background:#1e293b;border-radius:10px;padding:11px 13px;border:1px solid #263348;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.2px;
                    color:#475569;margin-bottom:5px;font-weight:600;">Turno actual</div>
        <div id="dp-name" style="font-size:19px;font-weight:700;color:#f1f5f9;
                                  line-height:1.2;min-height:24px;">—</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
          <div id="dp-tasks"   style="font-size:11px;color:#3b82f6;"></div>
          <div id="dp-counter" style="font-size:11px;color:#475569;"></div>
        </div>
      </div>
    </div>
    <div id="dp-timer-wrap" style="text-align:center;padding:8px 14px 4px;background:#0f172a;">
      <div id="dp-timer" style="font-size:52px;font-weight:800;letter-spacing:-3px;
           color:#f1f5f9;font-family:'SF Mono','Fira Code','Courier New',monospace;
           line-height:1;transition:color .3s;">2:00</div>
    </div>
    <div style="padding:6px 14px 10px;background:#0f172a;">
      <div style="height:3px;background:#1e293b;border-radius:2px;overflow:hidden;">
        <div id="dp-progress" style="height:100%;background:#3b82f6;border-radius:2px;
             width:0%;transition:width .5s ease;"></div>
      </div>
    </div>
    <div style="display:flex;gap:8px;padding:0 14px 10px;background:#0f172a;">
      <button id="dp-play"  style="flex:2;padding:10px;border:none;border-radius:8px;
              background:#3b82f6;color:#fff;cursor:pointer;font-size:20px;font-weight:700;
              transition:background .15s;" title="Iniciar/Pausar">▶</button>
      <button id="dp-reset" style="flex:1;padding:10px;border:none;border-radius:8px;
              background:#1e293b;color:#64748b;cursor:pointer;font-size:17px;
              transition:background .15s,color .15s;" title="Reiniciar">↺</button>
      <button id="dp-next"  style="flex:1;padding:10px;border:none;border-radius:8px;
              background:#1e293b;color:#64748b;cursor:pointer;font-size:17px;
              transition:background .15s,color .15s;" title="Siguiente">→</button>
    </div>
    <div id="dp-status" style="text-align:center;font-size:11px;color:#475569;
         padding:0 14px 6px;background:#0f172a;min-height:16px;"></div>
    <div style="height:1px;background:#1e293b;"></div>
    <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#0a1120;">
      <button id="dp-fetch-dom" style="flex:1;padding:7px 6px;border:none;border-radius:6px;
              background:#1e293b;color:#94a3b8;cursor:pointer;font-size:11px;font-weight:500;
              transition:background .15s,color .15s;">📄 Cargar lista</button>
      <button id="dp-shuffle" style="padding:7px 11px;border:none;border-radius:6px;
              background:#1e293b;color:#94a3b8;cursor:pointer;font-size:13px;
              transition:background .15s,color .15s;" title="Orden aleatorio">🔀</button>
    </div>
    <div id="dp-list" style="max-height:200px;overflow-y:auto;padding:4px 10px 12px;background:#0a1120;"></div>
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

  // Posición: intentar colocar el ítem justo después de "Jira" en el sidebar.
  // Estrategia 1 — dentro del desplegable: buscar el nodo de texto "Todo"
  //   que esté descendiente de un bloque que también contenga "Jira".
  // Estrategia 2a — role="treeitem": buscar el treeitem cuyo leaf diga "Jira".
  // Estrategia 2b — data-block-id: buscar el bloque de Notion cuyo leaf diga "Jira".
  // Estrategia 2c — findItemRow: buscar el nodo de texto "Jira" y subir al nivel
  //   de ítem usando la heurística de hermanos con texto de página.
  // Estrategia 3 — fallback final: penúltimo hijo del sidebar.

  // Busca un nodo hoja cuyo texto sea exactamente labelText
  function findTextNode(labelText) {
    return Array.from(sidebar.querySelectorAll("*")).find(
      el => el.children.length === 0 && el.textContent.trim() === labelText
    );
  }

  // Sube desde startNode hasta el "row" del ítem del sidebar.
  // Se detiene cuando el nodo tiene hermanos con 5+ letras consecutivas
  // (indica que estamos al nivel de ítem, no dentro de un sub-componente).
  function findItemRow(startNode) {
    let node = startNode;
    while (node.parentElement && node.parentElement !== sidebar) {
      const parent = node.parentElement;
      const siblings = Array.from(parent.children).filter(s => s !== node);
      if (siblings.some(s => /[a-zA-ZÀ-ÿ]{5,}/.test(s.textContent))) return node;
      node = parent;
    }
    return node;
  }

  let inserted = false;

  // Estrategia 1: buscar "Todo" dentro de un contenedor que también tenga "Jira"
  const todoNode = findTextNode("Todo");
  if (todoNode) {
    let ancestor = todoNode.parentElement;
    let jiraContext = false;
    for (let i = 0; i < 10 && ancestor && ancestor !== sidebar; i++) {
      if (ancestor.textContent.includes("Jira")) { jiraContext = true; break; }
      ancestor = ancestor.parentElement;
    }
    if (jiraContext) {
      const todoRow = todoNode.closest("[data-block-id], [role='treeitem'], div[style]") || todoNode.parentElement;
      todoRow.insertAdjacentElement("afterend", item);
      inserted = true;
    }
  }

  // Estrategia 2a: buscar sidebar item con role="treeitem" cuyo leaf diga "Jira"
  if (!inserted) {
    const jiraTreeItem = Array.from(sidebar.querySelectorAll('[role="treeitem"]'))
      .find(el => Array.from(el.querySelectorAll("*"))
        .some(n => n.children.length === 0 && n.textContent.trim() === "Jira"));
    if (jiraTreeItem) {
      jiraTreeItem.insertAdjacentElement("afterend", item);
      inserted = true;
    }
  }

  // Estrategia 2b: buscar bloque Notion con data-block-id cuyo leaf diga "Jira"
  if (!inserted) {
    const jiraBlock = Array.from(sidebar.querySelectorAll("[data-block-id]"))
      .find(el => Array.from(el.querySelectorAll("*"))
        .some(n => n.children.length === 0 && n.textContent.trim() === "Jira"));
    if (jiraBlock) {
      jiraBlock.insertAdjacentElement("afterend", item);
      inserted = true;
    }
  }

  // Estrategia 2c: buscar el nodo de texto "Jira" y subir al nivel de ítem
  if (!inserted) {
    const jiraNode = findTextNode("Jira");
    if (jiraNode) {
      findItemRow(jiraNode).insertAdjacentElement("afterend", item);
      inserted = true;
    }
  }

  // Estrategia 3: penúltimo hijo del sidebar
  if (!inserted) {
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
    this.textContent = "📄 Cargar lista";
    if (res?.success) {
      hasWarned = false;
      const n = res.participants.length;
      setDpStatus(`✓ ${n} participante${n !== 1 ? "s" : ""} cargado${n !== 1 ? "s" : ""}`, "success");
      setTimeout(() => setDpStatus(""), 3000);
    } else {
      setDpStatus(res?.error || "Error al leer la página", "error");
    }
  });

  document.getElementById("dp-shuffle").addEventListener("click", async function () {
    hasWarned = false;
    const res = await sendBg("SHUFFLE_PARTICIPANTS");
    if (res?.timerState?.participants?.length) {
      setDpStatus("Orden aleatorio aplicado", "success");
      setTimeout(() => setDpStatus(""), 2500);
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
  if (panelVisible) {
    sendBg("GET_STATE").then(res => {
      if (!res?.timerState?.participants?.length) autoLoadFromDom();
    });
  }
}

async function autoLoadFromDom() {
  setDpStatus("Cargando participantes\u2026");
  const res = await sendBg("FETCH_FROM_DOM");
  if (res?.success) {
    const n = res.participants.length;
    setDpStatus(`\u2713 ${n} participante${n !== 1 ? "s" : ""} cargado${n !== 1 ? "s" : ""}`, "success");
    setTimeout(() => setDpStatus(""), 3000);
  } else {
    setDpStatus("Pulsa \u2018Cargar lista\u2019 para obtener los participantes", "");
  }
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

  const done = state.done || [];

  const progressEl = document.getElementById("dp-progress");
  if (progressEl && activeTotal > 0) {
    const donePct = participants.filter((_, i) =>
      !absent.includes(i) && (i < state.currentIndex || done.includes(i))
    ).length;
    progressEl.style.width = Math.round((donePct / activeTotal) * 100) + "%";
  }

  renderParticipantList(participants, state.currentIndex, absent, done);
}

// ── Lista de participantes ────────────────────────────────────────────
function renderParticipantList(participants, currentIndex, absent, done = []) {
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

