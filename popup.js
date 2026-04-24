// ==========================
// 🔊 AUDIO (beep con Web Audio API)
// ==========================

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function beep(freq = 880, duration = 200, volume = 0.3) {
  try {
    const ctx  = getAudioCtx();
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

function playWarning() {
  beep(880, 250);
  setTimeout(() => beep(880, 250), 350);
}

function playEnd() {
  beep(523, 250);
  setTimeout(() => beep(659, 250), 300);
  setTimeout(() => beep(784, 500), 600);
}

// ==========================
// 🔄 COMUNICACIÓN CON BACKGROUND
// ==========================

function send(type, data = {}) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ type, ...data }, response => resolve(response))
  );
}

// ==========================
// 🖥️ ESTADO LOCAL DEL POPUP
// ==========================

let hasWarned     = false;
let hasAutoStopped = false;

function resetLocalFlags() {
  hasWarned      = false;
  hasAutoStopped = false;
}

// ==========================
// 🎨 RENDER
// ==========================

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderParticipants(participants, currentIndex, absent) {
  const container = document.getElementById("participants-list");

  if (!participants || participants.length === 0) {
    container.innerHTML =
      '<div class="empty-state">Configura tus credenciales (⚙️) y carga los participantes.</div>';
    return;
  }

  container.innerHTML = participants.map((p, i) => {
    const isAbsent = absent.includes(i);
    const cls = [
      "participant-item",
      i === currentIndex && !isAbsent ? "active" : "",
      i < currentIndex && !isAbsent  ? "done"   : "",
      isAbsent ? "absent" : ""
    ].filter(Boolean).join(" ");

    const absentTitle = isAbsent ? "Marcar como presente" : "Marcar como ausente";
    const absentIcon  = isAbsent ? "✓" : "✕";

    return `
      <div class="${cls}" data-index="${i}" title="Ir a ${escapeHtml(p.name)}">
        <div class="avatar">${escapeHtml(p.name.charAt(0).toUpperCase())}</div>
        <span class="p-name">${escapeHtml(p.name)}</span>
        <span class="p-tasks">${p.taskCount} tarea${p.taskCount !== 1 ? "s" : ""}</span>
        <button class="btn-absent" data-index="${i}" title="${absentTitle}">${absentIcon}</button>
      </div>`;
  }).join("");

  // Clic en la fila → saltar a esa persona
  container.querySelectorAll(".participant-item").forEach(el => {
    el.addEventListener("click", async e => {
      if (e.target.classList.contains("btn-absent")) return;
      resetLocalFlags();
      await send("JUMP_TO", { index: parseInt(el.dataset.index, 10) });
    });
  });

  // Clic en ✕/✓ → marcar/desmarcar ausente
  container.querySelectorAll(".btn-absent").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      resetLocalFlags();
      await send("TOGGLE_ABSENT", { index: parseInt(btn.dataset.index, 10) });
    });
  });
}

function setStatus(msg, type = "") {
  const el = document.getElementById("status-msg");
  el.textContent  = msg;
  el.className    = "status-msg" + (type ? ` ${type}` : "");
}

// ==========================
// 🔁 BUCLE DE ACTUALIZACIÓN
// ==========================

async function updateUI() {
  const res = await send("GET_STATE");
  const state = res?.timerState;
  if (!state) return;

  // Calcular tiempo restante
  let remaining = state.duration - state.elapsed;
  if (state.running && state.startTime) {
    remaining -= (Date.now() - state.startTime);
  }
  remaining = Math.max(0, remaining);

  const totalSecs = Math.ceil(remaining / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;

  // Mostrar tiempo
  document.getElementById("timer-display").textContent =
    `${mins}:${secs.toString().padStart(2, "0")}`;

  // Clases de advertencia / fin
  const wrap      = document.getElementById("timer-wrap");
  const inProgress = state.running || state.elapsed > 0;

  if (totalSecs === 0 && inProgress) {
    wrap.classList.remove("warning");
    wrap.classList.add("finished");
  } else if (totalSecs <= 10 && totalSecs > 0 && inProgress) {
    wrap.classList.add("warning");
    wrap.classList.remove("finished");
    if (!hasWarned) {
      hasWarned = true;
      playWarning();
    }
  } else {
    wrap.classList.remove("warning", "finished");
  }

  // Parar automáticamente cuando llegue a 0
  if (remaining === 0 && state.running && !hasAutoStopped) {
    hasAutoStopped = true;
    await send("START_PAUSE");
    playEnd();
  }

  // Resetear flags locales si el timer está a cero y parado
  if (state.elapsed === 0 && !state.running) {
    resetLocalFlags();
  }

  // Botón play/pause
  document.getElementById("btn-play-pause").textContent =
    state.running ? "⏸" : "▶";

  // Persona actual
  const participants = state.participants || [];
  const absent       = state.absent || [];
  const current = participants[state.currentIndex] || null;

  document.getElementById("current-name").textContent =
    current ? escapeHtml(current.name) : "—";
  document.getElementById("current-tasks").textContent =
    current ? `${current.taskCount} tarea${current.taskCount !== 1 ? "s" : ""}` : "";

  const activeTotal     = participants.filter((_, i) => !absent.includes(i)).length;
  const activeDone      = participants.filter((_, i) => !absent.includes(i) && i < state.currentIndex).length;
  const absentCount     = absent.length;
  let counterText = "";
  if (participants.length > 0) {
    counterText = `${activeDone + 1} de ${activeTotal}`;
    if (absentCount > 0) counterText += ` · ${absentCount} ausente${absentCount !== 1 ? "s" : ""}`;
  }
  document.getElementById("counter").textContent = counterText;

  // Lista de participantes
  renderParticipants(participants, state.currentIndex, absent);
}

// ==========================
// 🚀 INIT
// ==========================

document.addEventListener("DOMContentLoaded", () => {

  // Actualizar UI cada 200 ms
  updateUI();
  setInterval(updateUI, 200);

  // ── Botón: Cargar desde DOM (página de Notion abierta) ──
  document.getElementById("btn-fetch-dom").addEventListener("click", async function () {
    this.disabled = true;
    this.textContent = "Leyendo…";
    setStatus("Leyendo la página de Notion…");

    const res = await send("FETCH_FROM_DOM");

    this.disabled = false;
    this.textContent = "📄 Desde página";

    if (res?.success) {
      resetLocalFlags();
      const n = res.participants.length;
      setStatus(`✓ ${n} participante${n !== 1 ? "s" : ""} cargado${n !== 1 ? "s" : ""} desde Notion`, "success");
      setTimeout(() => setStatus(""), 3000);
    } else {
      setStatus(res?.error || "Error al leer la página de Notion", "error");
    }
  });

  // ── Botón: Cargar desde API de Notion ──
  document.getElementById("btn-fetch").addEventListener("click", async function () {
    this.disabled = true;
    this.textContent = "Cargando…";
    setStatus("Conectando con Notion…");

    const res = await send("FETCH_PARTICIPANTS");

    this.disabled = false;
    this.textContent = "↻ API";

    if (res?.success) {
      resetLocalFlags();
      const n = res.participants.length;
      setStatus(`✓ ${n} participante${n !== 1 ? "s" : ""} cargado${n !== 1 ? "s" : ""} vía API`, "success");
      setTimeout(() => setStatus(""), 3000);
    } else {
      setStatus(res?.error || "Error al conectar con Notion", "error");
    }
  });

  // ── Botón: Play / Pause ──
  document.getElementById("btn-play-pause").addEventListener("click", async () => {
    // Desbloquear AudioContext (requiere gesto del usuario)
    if (audioCtx?.state === "suspended") audioCtx.resume();
    await send("START_PAUSE");
  });

  // ── Botón: Reiniciar ──
  document.getElementById("btn-reset").addEventListener("click", async () => {
    resetLocalFlags();
    await send("RESET_TIMER");
  });

  // ── Botón: Siguiente persona ──
  document.getElementById("btn-next").addEventListener("click", async () => {
    resetLocalFlags();
    await send("NEXT_PERSON");
  });

  // ── Botón: Opciones ──
  document.getElementById("btn-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});
