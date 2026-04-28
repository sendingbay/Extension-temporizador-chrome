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
  "No assignee", "Unassigned", "Empty", "Count", "Open", "Delete", "Duplicate",
  "Skip to content", "···", "...",
  "Name",          // cabecera de columna por defecto en Notion (EN)
  "Load more groups", "New group", "+ New group", "Load more",
  // Español
  "Sin título", "Ir al contenido", "Sin asignar", "Sin Asignado", "Vacío",
  "Nueva página", "+ Nueva página", "Nuevo", "Abrir", "Eliminar",
  "Filtrar", "Ordenar", "Agrupar", "Propiedades", "Compartir",
  "Añadir una página", "Calcular",
  "Nombre",        // cabecera de columna por defecto en Notion (ES)
  "Cargar más grupos", "Nuevo grupo", "+ Nuevo grupo", "Cargar más",
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

// ── Auto-click ALL "Cargar más grupos" buttons y extraer ─────
// Expande todos los grupos colapsados automáticamente (máx. 10 rondas)
// antes de extraer los nombres, para incluir participantes ocultos.
async function autoClickAndExtract() {
  const LOAD_MORE_TEXTS = [
    "Cargar más grupos", "Load more groups",
    "Cargar más", "Load more",
    "Show more", "Ver más",
  ];

  for (let round = 0; round < 10; round++) {
    const clickable = Array.from(
      document.querySelectorAll('button, [role="button"], [tabindex="0"]')
    );
    const buttons = clickable.filter(el =>
      LOAD_MORE_TEXTS.some(t => el.textContent.trim().startsWith(t))
    );
    if (buttons.length === 0) break;   // no quedan botones → terminar
    buttons.forEach(b => b.click());
    await new Promise(r => setTimeout(r, 700));  // esperar que el DOM actualice
  }

  return extractNamesFromNotion();
}

// ── Escuchar mensajes del background/popup ───────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_DOM_PARTICIPANTS") {
    autoClickAndExtract().then(names => sendResponse({ names }));
    return true;
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
    document.querySelector('[role="navigation"]') ||
    document.querySelector('[aria-label*="sidebar" i]') ||
    document.querySelector('[aria-label*="navigation" i]') ||
    null
  );
}

// ── CSS del panel (tema oscuro Notion) ───────────────────────
const PANEL_CSS = `
  #daily-timer-panel * { box-sizing: border-box; margin: 0; padding: 0; }

  #dp-list::-webkit-scrollbar { width: 3px; }
  #dp-list::-webkit-scrollbar-track { background: transparent; }
  #dp-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

  #dp-play:hover                              { background: #1a6fc4 !important; }
  #dp-reset:hover, #dp-next:hover,
  #dp-fetch-dom:hover, #dp-shuffle:hover      { background: rgba(255,255,255,0.1) !important; }

  #dp-list .dp-item {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 8px; border-radius: 4px; cursor: pointer;
    transition: background .15s; border-left: 2px solid transparent;
    margin-bottom: 1px;
  }
  #dp-list .dp-item:hover  { background: rgba(255,255,255,0.055); }
  #dp-list .dp-item.active { background: rgba(35,131,226,0.18); border-left-color: #2383e2; }
  #dp-list .dp-item.done   { background: rgba(52,168,83,0.15);  border-left-color: #34a853; }
  #dp-list .dp-item.absent { opacity: .4; border-left-color: transparent; }
  #dp-list .dp-item.absent .dp-pname { text-decoration: line-through; }

  #dp-list .dp-avatar {
    width: 22px; height: 22px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0;
    background: rgba(255,255,255,0.18);
  }
  #dp-list .dp-item.active .dp-avatar { background: #2383e2; }
  #dp-list .dp-item.done   .dp-avatar { background: #34a853; }

  #dp-list .dp-pname  { flex: 1; font-size: 14px; color: rgba(255,255,255,0.81); line-height: 1.3; }
  #dp-list .dp-item.done   .dp-pname { color: #34a853; }
  #dp-list .dp-item.active .dp-pname { color: #fff; font-weight: 600; }
  #dp-list .dp-ptasks { font-size: 9px; color: rgba(255,255,255,0.3); white-space: nowrap; }

  #dp-list .dp-absent-btn {
    background: none; border: none; cursor: pointer;
    font-size: 11px; padding: 2px 3px; border-radius: 3px;
    transition: color .15s, background .15s; flex-shrink: 0;
    color: rgba(255,255,255,0.2);
  }
  #dp-list .dp-absent-btn:hover        { color: #f87171; background: rgba(248,113,113,.15); }
  #dp-list .dp-item.absent .dp-absent-btn { color: #f87171; }

  #dp-timer-wrap.warning  #dp-timer { color: #fbbf24 !important; animation: dp-pulse .5s ease-in-out infinite alternate; }
  #dp-timer-wrap.finished #dp-timer { color: #34a853 !important; animation: none; }
  @keyframes dp-pulse { from { opacity: 1; } to { opacity: .35; } }
`;

function injectPanelCSS() {
  const existing = document.getElementById("daily-panel-css");
  if (existing) existing.remove();
  const style = document.createElement("style");
  style.id = "daily-panel-css";
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);
}

// ── Construcción del HTML del panel ──────────────────────────
function buildPanelHTML() {
  return `
    <div style="padding:6px 10px 10px;">

      <!-- Separador superior -->
      <div style="height:1px;background:rgba(255,255,255,0.07);margin-bottom:8px;"></div>

      <!-- Turno actual -->
      <div style="background:rgba(255,255,255,0.05);border-radius:5px;
                  padding:7px 9px;margin-bottom:7px;border:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;
                    color:rgba(255,255,255,0.35);margin-bottom:2px;font-weight:600;">Turno actual</div>
        <div id="dp-name" style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.87);
                                  line-height:1.3;min-height:18px;">—</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
          <div id="dp-tasks"   style="font-size:10px;color:#2383e2;"></div>
          <div id="dp-counter" style="font-size:10px;color:rgba(255,255,255,0.3);"></div>
        </div>
      </div>

      <!-- Timer -->
      <div id="dp-timer-wrap" style="text-align:center;padding:2px 0;">
        <div id="dp-timer" style="font-size:38px;font-weight:800;letter-spacing:-2px;
             color:rgba(255,255,255,0.87);
             font-family:'SF Mono','Fira Code','Courier New',monospace;
             line-height:1;transition:color .3s;">2:00</div>
      </div>

      <!-- Barra de progreso -->
      <div style="height:2px;background:rgba(255,255,255,0.08);border-radius:2px;
                  margin:6px 0 8px;overflow:hidden;">
        <div id="dp-progress" style="height:100%;background:#2383e2;border-radius:2px;
             width:0%;transition:width .5s ease;"></div>
      </div>

      <!-- Controles -->
      <div style="display:flex;gap:5px;margin-bottom:5px;">
        <button id="dp-play"  style="flex:2;padding:7px 0;border:none;border-radius:4px;
                background:#2383e2;color:#fff;cursor:pointer;font-size:16px;
                transition:background .15s;" title="Iniciar/Pausar">▶</button>
        <button id="dp-reset" style="flex:1;padding:7px 0;border:none;border-radius:4px;
                background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.65);
                cursor:pointer;font-size:14px;transition:background .15s;"
                title="Reiniciar">↺</button>
        <button id="dp-next"  style="flex:1;padding:7px 0;border:none;border-radius:4px;
                background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.65);
                cursor:pointer;font-size:14px;transition:background .15s;"
                title="Siguiente">→</button>
      </div>

      <!-- Estado -->
      <div id="dp-status" style="text-align:center;font-size:10px;
           color:rgba(255,255,255,0.35);min-height:13px;margin-bottom:5px;"></div>

      <!-- Acciones -->
      <div style="display:flex;gap:4px;margin-bottom:5px;">
        <button id="dp-fetch-dom" style="flex:1;padding:5px 4px;border:none;border-radius:4px;
                background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.55);
                cursor:pointer;font-size:10px;font-weight:500;
                transition:background .15s;">📄 Cargar lista</button>
        <button id="dp-shuffle" style="padding:5px 9px;border:none;border-radius:4px;
                background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.55);
                cursor:pointer;font-size:12px;transition:background .15s;"
                title="Orden aleatorio">🔀</button>
      </div>

      <!-- Lista de participantes -->
      <div id="dp-list" style="max-height:180px;overflow-y:auto;"></div>
    </div>
  `;
}

// ── Inyección del ítem del sidebar + panel ────────────────────
function injectTimerUI() {
  if (document.getElementById(TIMER_BUTTON_ID)) return;

  const sidebar = getNotionSidebar();

  if (!sidebar) {
    // Sin sidebar → devolver false para que el retry lo intente más tarde.
    // El botón flotante solo se usa como último recurso desde waitForNotionAndInject.
    return false;
  }

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

  // Busca un elemento cuyo texto visible sea exactamente labelText.
  // Primero hoja pura (sin hijos), luego hoja con máximo 2 sub-nodos
  // (Notion a veces añade spans internos para íconos o a11y).
  function findTextNode(labelText) {
    const all = Array.from(sidebar.querySelectorAll("*"));
    return (
      all.find(el => el.children.length === 0 && el.textContent.trim() === labelText) ||
      all.find(el => el.children.length <= 2 && el.textContent.trim() === labelText)
    );
  }

  // Sube desde startNode hasta el "row" del ítem del sidebar.
  // Se detiene cuando el nodo tiene hermanos con 3+ letras consecutivas
  // (umbral reducido de 5 a 3 para cubrir nombres cortos como "Jira").
  function findItemRow(startNode) {
    let node = startNode;
    while (node.parentElement && node.parentElement !== sidebar) {
      const parent = node.parentElement;
      const siblings = Array.from(parent.children).filter(s => s !== node);
      if (siblings.some(s => /[a-zA-ZÀ-ÿ]{3,}/.test(s.textContent))) return node;
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
        .some(n => n.children.length <= 2 && n.textContent.trim() === "Jira"));
    if (jiraTreeItem) {
      jiraTreeItem.insertAdjacentElement("afterend", item);
      inserted = true;
    }
  }

  // Estrategia 2b: buscar bloque Notion con data-block-id cuyo leaf diga "Jira"
  if (!inserted) {
    const jiraBlock = Array.from(sidebar.querySelectorAll("[data-block-id]"))
      .find(el => Array.from(el.querySelectorAll("*"))
        .some(n => n.children.length <= 2 && n.textContent.trim() === "Jira"));
    if (jiraBlock) {
      jiraBlock.insertAdjacentElement("afterend", item);
      inserted = true;
    }
  }

  // Estrategia 2d: buscar por role="link" o anchor cuyo texto contenga "Jira"
  if (!inserted) {
    const jiraLink = Array.from(sidebar.querySelectorAll('[role="link"], a'))
      .find(el => el.textContent.trim() === "Jira");
    if (jiraLink) {
      findItemRow(jiraLink).insertAdjacentElement("afterend", item);
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

  // Si ninguna estrategia encontró "Jira", el sidebar aún no está listo.
  // Devolvemos false para que el retry lo intente más tarde sin insertar
  // el botón en una posición incorrecta.
  if (!inserted) {
    return false;
  }

  // Panel inline en el sidebar (justo debajo del botón, no flotante).
  // Solo se crea una vez aunque injectTimerUI se llame varias veces.
  if (!document.getElementById(PANEL_ID)) {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = buildPanelHTML();
    Object.assign(panel.style, {
      overflow:   "hidden",
      maxHeight:  "0",
      transition: "max-height 0.28s ease",
    });
    item.insertAdjacentElement("afterend", panel);
    injectPanelCSS();
    bindPanelEvents();
    setInterval(updatePanel, 200);
  }

  // Guardia permanente: re-inyectar el botón si Notion lo elimina al
  // navegar entre páginas (React re-renders). subtree:true + debounce.
  let guardTimer = null;
  const sidebarGuard = new MutationObserver(() => {
    clearTimeout(guardTimer);
    guardTimer = setTimeout(() => {
      if (!document.getElementById(TIMER_BUTTON_ID)) {
        injectTimerUI();
      }
    }, 300);
  });
  sidebarGuard.observe(sidebar, { childList: true, subtree: true });

  return true;
}

// ── Eventos del panel ─────────────────────────────────────────
function bindPanelEvents() {
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
  el.style.color = type === "error" ? "#dc2626" : type === "success" ? "#16a34a" : "#94a3b8";
}

function togglePanel(forceState) {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  panelVisible = typeof forceState === "boolean" ? forceState : !panelVisible;
  // Animar con max-height (el panel está inline en el sidebar)
  panel.style.maxHeight = panelVisible ? "600px" : "0";
  if (panelVisible) {
    _lastListFingerprint = ""; // forzar re-render al abrir
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
// Guardamos la última "huella" para evitar reconstruir el DOM
// en cada tick del temporizador y eliminar el parpadeo al pasar el cursor.
let _lastListFingerprint = "";

function renderParticipantList(participants, currentIndex, absent, done = []) {
  const container = document.getElementById("dp-list");
  if (!container) return;

  if (!participants || participants.length === 0) {
    const empty = '<div style="color:#555;font-size:12px;text-align:center;padding:8px 0;">' +
      'Carga los participantes con los botones de arriba.</div>';
    if (container.innerHTML !== empty) container.innerHTML = empty;
    _lastListFingerprint = "";
    return;
  }

  // Calcular huella: nombres + estado de cada participante
  const fingerprint = participants.map((p, i) => {
    const isAbsent = absent.includes(i);
    const state = i === currentIndex && !isAbsent ? "A"
                : i < currentIndex  && !isAbsent ? "D"
                : isAbsent ? "X" : "-";
    return `${p.name}|${p.taskCount}|${state}`;
  }).join(";");

  if (fingerprint === _lastListFingerprint) {
    // Nada cambió → no tocar el DOM, el hover permanece intacto
    return;
  }
  _lastListFingerprint = fingerprint;

  // Reconstruir solo cuando hay cambios reales
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

// ── Botón flotante (último recurso si el sidebar nunca se detecta) ──
function injectFloatingFallback() {
  if (document.getElementById(TIMER_BUTTON_ID)) return;
  console.warn("[Daily Timer] Jira no encontrado en sidebar tras 60 s. Usando botón flotante.");

  const btn = document.createElement("button");
  btn.id = TIMER_BUTTON_ID;
  btn.textContent = "⏱";
  btn.title = "Daily Timer";
  Object.assign(btn.style, {
    position: "fixed", bottom: "88px", left: "16px", zIndex: "99998",
    width: "48px", height: "48px", borderRadius: "50%",
    background: "#3b82f6", color: "#fff", border: "none",
    cursor: "pointer", fontSize: "20px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.25)", transition: "background 0.15s",
  });
  btn.addEventListener("mouseenter", () => { btn.style.background = "#2563eb"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "#3b82f6"; });
  btn.addEventListener("click", () => togglePanel());
  document.body.appendChild(btn);

  if (!document.getElementById(PANEL_ID)) {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = buildPanelHTML();
    Object.assign(panel.style, {
      position: "fixed", bottom: "24px", left: "16px", zIndex: "99999",
      width: "320px", overflow: "hidden", maxHeight: "0",
      transition: "max-height 0.28s ease",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    });
    document.body.appendChild(panel);
    injectPanelCSS();
    bindPanelEvents();
    setInterval(updatePanel, 200);
  }
}

// ── Inyección con MutationObserver (Notion carga dinámicamente) ──
function waitForNotionAndInject() {
  // Reintento cada 500 ms durante 60 s hasta que injectTimerUI() devuelva true
  // (significa que encontró "Jira" e insertó el botón correctamente).
  let retries = 0;
  const retryInterval = setInterval(() => {
    retries++;
    if (retries > 120) {
      clearInterval(retryInterval);
      // Último recurso: botón flotante si tras 60 s nunca se encontró "Jira"
      if (!document.getElementById(TIMER_BUTTON_ID)) {
        injectFloatingFallback();
      }
      return;
    }
    if (document.getElementById(TIMER_BUTTON_ID)) {
      clearInterval(retryInterval);
      return;
    }
    injectTimerUI();
  }, 500);
}

// Solo ejecutar dentro de notion.so
if (location.hostname.endsWith("notion.so")) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForNotionAndInject);
  } else {
    waitForNotionAndInject();
  }
}

