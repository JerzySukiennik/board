/* Standalone app: board, example questions, theme switch and the list of earlier boards kept in this browser. */
import { mountBoard } from "./board/ui.js";

const LOCAL = ["127.0.0.1", "localhost"].includes(location.hostname);
const API = LOCAL ? "http://127.0.0.1:8797" : "https://board-api.kalakasanyt.workers.dev";
const IDEAS = ["Dlaczego niebo jest niebieskie?", "Jak działa silnik rakietowy?", "Skąd się biorą pory roku?", "Jak rozwiązać 2x + 3 = 11?", "Dlaczego samolot lata?", "Co to jest fotosynteza?"];
const GREETING = `title O co chcesz zapytać?
note Napisz pytanie na dole
note albo narysuj je tutaj markerem.
fig I 44 30
circle 15 15 10 orange
circle 11.5 12.5 1 orange fill
circle 18.5 12.5 1 orange fill
curve 9.5 16.5 12 20 15 21 18 20 20.5 16.5 orange
curve 28 8 33 6 36 10 33 14 31 17 blue
circle 31 21.5 0.7 blue fill`;

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const root = document.getElementById("board");
const ideas = document.getElementById("ideas");
const drawer = document.getElementById("drawer");
const list = document.getElementById("drawer-list");
let currentId = null;

function setTheme(theme) {
  root.dataset.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll("#theme button").forEach((b) => {
    const on = b.dataset.theme === theme;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  });
  document.querySelector('meta[name="theme-color"]').content = theme === "chalk" ? "#2b2a27" : "#e9e6df";
  store.set("board.theme", theme);
}
setTheme(store.get("board.theme", "white"));

const params = new URLSearchParams(location.search);
let debug;
try {
  debug = LOCAL && params.get("debug") ? JSON.parse(params.get("debug")) : undefined;
} catch {}

const ui = mountBoard(root, {
  api: API,
  debug,
  onEvent(ev, board) {
    if (ev.type === "change") save(board);
    if (ev.type === "state") {
      const off = board.hasLesson || board.busy;
      ideas.classList.toggle("off", off);
      board.insetBottom = off ? 0 : ideas.offsetHeight + 22;
    }
  },
  onNew() {
    currentId = null;
  },
});
const board = ui.board;
root.querySelector(".bd-surface").append(ideas);
ideas.hidden = false;

function save(b) {
  if (!b.question) return;
  const all = store.get("board.history", []);
  if (!currentId) currentId = Date.now().toString(36);
  const entry = { id: currentId, q: b.question, at: Date.now(), data: b.serialize() };
  const next = [entry, ...all.filter((e) => e.id !== currentId)].slice(0, 14);
  store.set("board.history", next);
}

function greet() {
  board.reset();
  board.greet(GREETING);
}

ideas.innerHTML = IDEAS.map((q, i) => `<button style="--i:${i}">${q}</button>`).join("");
ideas.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  currentId = null;
  ui.ask(b.textContent);
});

document.getElementById("theme").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (b) setTheme(b.dataset.theme);
});

function openDrawer() {
  const all = store.get("board.history", []);
  const fmt = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  list.innerHTML = all.length
    ? all.map((e, i) => `<button class="row" data-id="${e.id}" style="--i:${i}"><b></b><small>${fmt.format(e.at)} · ${(e.data.log || []).filter((l) => l.t !== "reply").length > 1 ? "z dopytaniami" : "jedna lekcja"}</small></button>`).join("")
    : `<p class="none">Tu pojawią się tablice, które już zapisałeś pytaniami. Zostają tylko w tej przeglądarce.</p>`;
  list.querySelectorAll(".row").forEach((r, i) => (r.querySelector("b").textContent = all[i].q));
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add("on"));
}
function closeDrawer() {
  drawer.classList.remove("on");
  setTimeout(() => (drawer.hidden = true), 260);
}
document.getElementById("history-btn").addEventListener("click", openDrawer);
document.getElementById("drawer-x").addEventListener("click", closeDrawer);
drawer.addEventListener("click", (ev) => {
  if (ev.target === drawer) return closeDrawer();
  const row = ev.target.closest(".row");
  if (!row) return;
  const entry = store.get("board.history", []).find((e) => e.id === row.dataset.id);
  if (!entry) return;
  currentId = entry.id;
  board.load(entry.data);
  closeDrawer();
});
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !drawer.hidden) closeDrawer();
});

board.ready().then(() => {
  const q = params.get("q");
  if (q) ui.ask(q.slice(0, 600));
  else greet();
  document.body.classList.add("ready");
});

if (LOCAL) {
  window.board = board;
  if (!debug) {
    const seg = document.createElement("div");
    seg.className = "seg";
    seg.title = "Tylko lokalnie: model do porównania";
    seg.innerHTML = `<button data-model="claude-haiku-5-5">Haiku</button><button data-model="claude-sonnet-5-5">Sonnet</button>`;
    document.querySelector(".top-r").prepend(seg);
    const pick = (model) => {
      board.opts.debug = { model, effort: model.includes("sonnet") ? "low" : "medium" };
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.model === model));
      store.set("board.localModel", model);
    };
    seg.addEventListener("click", (ev) => ev.target.dataset.model && pick(ev.target.dataset.model));
    pick(store.get("board.localModel", "claude-sonnet-5-5"));
  }
}
