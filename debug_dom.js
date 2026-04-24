// ── Pega esto en la consola de Chrome (F12) con el board de Notion abierto ──
// y copia el resultado completo aquí.

(function debugNotion() {
  // 1. ¿Hay role="columnheader"?
  const colHeaders = [...document.querySelectorAll('[role="columnheader"]')];
  console.log("columnheader count:", colHeaders.length, colHeaders.map(e => e.textContent.trim().slice(0, 40)));

  // 2. Imgs pequeñas visibles con su posición y ancestro
  const imgs = [...document.querySelectorAll('img')].filter(img => {
    const r = img.getBoundingClientRect();
    return r.width >= 6 && r.width <= 48 && r.height >= 6 && r.height <= 48
      && r.top > 0 && r.top < window.innerHeight && r.left > 150;
  });
  console.log("small imgs (x>150):", imgs.length);
  imgs.slice(0, 15).forEach(img => {
    const r = img.getBoundingClientRect();
    // Subir hasta encontrar un elemento con texto corto (el nombre)
    let el = img.parentElement;
    let name = "";
    for (let i = 0; i < 8 && el && !name; i++, el = el.parentElement) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);
      if (t.length > 2 && t.length < 45) name = t;
    }
    console.log(`  img at x=${Math.round(r.left)},y=${Math.round(r.top)} | text: "${name}"`);
  });

  // 3. ¿Cuál es el innerText del primer "Ana Karina"?
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found = [];
  let node;
  while ((node = walker.nextNode()) && found.length < 5) {
    if (node.textContent.includes("Ana Karina")) {
      const el = node.parentElement;
      const r = el.getBoundingClientRect();
      console.log("Ana Karina found:", el.tagName, el.className, "at x=" + Math.round(r.left) + " y=" + Math.round(r.top));
      found.push(el);
    }
  }
})();
