const FIELDS = ["notionKey", "databaseId", "nameProperty", "taskProperty"];

document.addEventListener("DOMContentLoaded", async () => {
  // Cargar valores guardados
  const saved = await chrome.storage.sync.get(FIELDS);
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (el && saved[key]) el.value = saved[key];
  }

  document.getElementById("btn-save").addEventListener("click", async () => {
    const statusEl = document.getElementById("status");

    const notionKey    = document.getElementById("notionKey").value.trim();
    const databaseId   = document.getElementById("databaseId").value.trim();
    const nameProperty = document.getElementById("nameProperty").value.trim() || "Name";
    const taskProperty = document.getElementById("taskProperty").value.trim();

    if (!notionKey || !databaseId) {
      statusEl.textContent = "El token y el ID de base de datos son obligatorios.";
      statusEl.className   = "status error";
      return;
    }

    await chrome.storage.sync.set({ notionKey, databaseId, nameProperty, taskProperty });

    statusEl.textContent = "✓ Configuración guardada correctamente.";
    statusEl.className   = "status success";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
  });
});
