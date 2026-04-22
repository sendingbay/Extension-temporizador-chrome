console.log("🚀 Extension cargada");


// ==========================
// 🧩 LEER TAREAS DEL DOM
// ==========================
function getTasksFromDOM() {
    const tasks = document.querySelectorAll("li, .task, div");

    return Array.from(tasks)
        .map(t => t.innerText.trim())
        .filter(t => t.length > 0);
}

console.log("📌 Tasks:", getTasksFromDOM());


// ==========================
// 🧭 BOTÓN EN 3 PUNTITOS
// ==========================
function addButtonToMenu() {
    if (document.getElementById("timer-btn")) return;

    const btn = document.createElement("button");
    btn.id = "timer-btn";
    btn.innerText = "⏱ 2 min";

    btn.style.position = "fixed";
    btn.style.top = "20px";
    btn.style.right = "20px";
    btn.style.zIndex = "9999";
    btn.style.padding = "10px";
    btn.style.background = "black";
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.cursor = "pointer";

    btn.onclick = startCountdown;

    document.body.appendChild(btn);
}

setInterval(addButtonToMenu, 1000);


// ==========================
// ⏱ TIMER 2 MIN
// ==========================
let interval = null;

function startCountdown() {
    let time = 120;

    const timerBox = document.createElement("div");

    timerBox.style.position = "fixed";
    timerBox.style.bottom = "20px";
    timerBox.style.right = "20px";
    timerBox.style.background = "black";
    timerBox.style.color = "white";
    timerBox.style.padding = "10px";
    timerBox.style.fontSize = "20px";
    timerBox.style.zIndex = 9999;

    document.body.appendChild(timerBox);

    clearInterval(interval);

    interval = setInterval(() => {
        let minutes = Math.floor(time / 60);
        let seconds = time % 60;

        timerBox.innerText =
            `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;

        time--;

        if (time < 0) {
            clearInterval(interval);
            timerBox.innerText = "⏰ Tiempo terminado";
        }
    }, 1000);
}