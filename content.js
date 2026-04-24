// ==========================
// 🧩 SCRAPER DE DOM — Notion
// ==========================
// Este script se inyecta en páginas de notion.so.
// Escucha mensajes del background y devuelve los nombres
// extraídos de la vista de base de datos activa.

function extractNamesFromNotion() {
  const results = [];
  const seen    = new Set();

  function add(text) {
    const t = text?.replace(/\s+/g, " ").trim();
    if (!t || t.length === 0 || t.length > 80) return;
    if (seen.has(t)) return;
    // Descartar textos que son claramente UI de Notion
    const uiNoise = [
      "New", "Filter", "Sort", "Search", "Group", "Properties",
      "Share", "Export", "···", "Add a page", "Calculate",
      "Untitled", "Sin título"
    ];
    if (uiNoise.some(n => t === n)) return;
    seen.add(t);
    results.push(t);
  }

  // ── Estrategia 1: Vista tabla ────────────────────────────────
  // En Notion, la primera celda de cada fila de tabla contiene el título.
  // El contenedor de filas tiene role="row" y las celdas role="gridcell".
  const rows = document.querySelectorAll('[role="row"]');
  rows.forEach(row => {
    const cells = row.querySelectorAll('[role="gridcell"]');
    if (cells.length > 0) {
      // La primera celda es siempre el título/nombre
      add(cells[0].textContent);
    }
  });

  // ── Estrategia 2: Vista board (tablero) ──────────────────────
  // Las tarjetas tienen role="button" dentro de columnas
  if (results.length === 0) {
    const cards = document.querySelectorAll('[role="button"] [placeholder="Untitled"], [role="button"] [data-content-editable-leaf]');
    cards.forEach(el => add(el.textContent));
  }

  // ── Estrategia 3: Vista lista / galería ─────────────────────
  // Los ítems tienen role="link" o son divs con data-block-id
  if (results.length === 0) {
    const links = document.querySelectorAll('[role="link"]');
    links.forEach(el => {
      // Tomar solo el texto del primer hijo (título, no propiedades)
      const first = el.firstElementChild;
      add(first ? first.textContent : el.textContent);
    });
  }

  // ── Estrategia 4: Fallback — cualquier elemento editable ─────
  // que esté dentro del área de contenido principal (no sidebar)
  if (results.length === 0) {
    const main = document.querySelector(
      ".notion-page-content, [data-content-editable-root], main"
    );
    if (main) {
      main.querySelectorAll("[contenteditable='true']").forEach(el => {
        // Solo texto de una sola línea (nombres)
        const t = el.textContent?.trim();
        if (t && !t.includes("\n")) add(t);
      });
    }
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
