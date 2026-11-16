/* Tableau de bord personnel.
   Tout est enregistré dans le localStorage de ce navigateur, sous la clé ci-dessous.
   Le bouton d'export crée une copie JSON ; Importer la restaure. */

const STORAGE_KEY = "tableau-de-bord-perso";
const TAGS = ["Travail", "Focus", "Perso", "Santé"];
const WEEKDAYS = ["di", "lu", "ma", "me", "je", "ve", "sa"];

const state = loadState();
let pendingImport = null;
let toastTimer = 0;
let lastFocus = null;

const els = {
  greeting: document.getElementById("greeting"),
  today: document.getElementById("today-label"),
  nowLine: document.getElementById("now-line"),
  theme: document.getElementById("theme-toggle"),
  agenda: document.getElementById("agenda-list"),
  agendaEmpty: document.getElementById("agenda-empty"),
  tasks: document.getElementById("task-list"),
  taskEmpty: document.getElementById("task-empty"),
  habits: document.getElementById("habit-list"),
  habitEmpty: document.getElementById("habit-empty"),
  goals: document.getElementById("goal-list"),
  goalEmpty: document.getElementById("goal-empty"),
  goalBar: document.getElementById("goal-bar"),
  goalBarWrap: document.getElementById("goal-bar-wrap"),
  dialog: document.getElementById("dialog"),
  toast: document.getElementById("toast"),
  themeColor: document.querySelector('meta[name="theme-color"]'),
};

init();

function init() {
  applyTheme();
  const timeField = document.querySelector('form[data-add="event"] input[name="time"]');
  if (timeField) timeField.value = nextHour();
  renderAll();
  document.documentElement.classList.remove("booting");

  document.body.addEventListener("input", (event) => {
    const field = event.target.closest("[data-field]");
    if (!field || field.type === "checkbox" || field.dataset.field === "time" || field.tagName === "SELECT") return;
    writeField(field);
    autosize(field);
  });

  document.body.addEventListener("change", (event) => {
    const field = event.target.closest("[data-field]");
    if (!field) return;
    writeField(field);
  });

  document.body.addEventListener("focusout", (event) => {
    const field = event.target.closest("[data-field]");
    if (!field || field.type === "checkbox" || field.tagName === "SELECT") return;
    if (field.dataset.field !== "time") {
      const trimmed = field.value.trim();
      if (trimmed !== field.value) field.value = trimmed;
    }
    writeField(field);
  });

  document.body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.tagName === "TEXTAREA") {
      event.preventDefault();
      event.target.blur();
    }
  });

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "copy-previous") {
      copyPreviousDay();
      return;
    }
    const row = button.closest("[data-kind]");
    if (!row) return;
    if (action === "delete") deleteItem(row.dataset.kind, row.dataset.id);
    if (action === "toggle-day") toggleHabitDay(row.dataset.id, button.dataset.date);
  });

  document.querySelectorAll("form[data-add]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      addItem(form);
    });
  });

  els.theme.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    save();
    applyTheme();
  });

  document.getElementById("export-btn").addEventListener("click", exportData);
  document.getElementById("import-input").addEventListener("change", onImportFile);
  document.getElementById("dialog-cancel").addEventListener("click", closeDialog);
  document.getElementById("dialog-ok").addEventListener("click", confirmImport);
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) closeDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.dialog.hidden) closeDialog();
  });

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      document.querySelectorAll("textarea").forEach(autosize);
    });
  });

  setInterval(refreshClock, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      renderAll();
    }
  });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = seed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    return sanitize(JSON.parse(raw));
  } catch (err) {
    const seeded = seed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    } catch (ignore) {}
    return seeded;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast("Impossible d’enregistrer dans ce navigateur.");
  }
}

function seed() {
  const today = new Date();
  const todayKey = iso(today);
  const habits = [
    ["Verre d’eau au réveil", "111011", true],
    ["Marche de vingt minutes", "101110", true],
    ["Lecture le soir", "011101", false],
    ["Écran rangé à 22 h 30", "110101", false],
    ["Repas pris assis", "111110", false],
  ].map(([name, pattern, doneToday]) => {
    const history = {};
    for (let daysAgo = 1; daysAgo <= 6; daysAgo += 1) {
      if (pattern[6 - daysAgo] === "1") history[iso(addDays(today, -daysAgo))] = true;
    }
    if (doneToday) history[todayKey] = true;
    return { id: uid(), name, history };
  });

  const events = [
    ["07:15", "Étirements", "Dix minutes, au calme", "Santé"],
    ["08:00", "Café et tour d’horizon", "Priorités du jour, sans ouvrir la boîte mail", "Perso"],
    ["09:15", "Point produit", "Équipe, vingt-cinq minutes", "Travail"],
    ["10:00", "Bloc de concentration", "Cadrage de la prochaine itération", "Focus"],
    ["12:30", "Déjeuner", "Loin de l’écran", "Perso"],
    ["14:00", "Entretien utilisateur", "Visio — questions prêtes avant", "Travail"],
    ["16:00", "Synthèse", "Décisions et suites à donner", "Travail"],
    ["18:30", "Courses et dîner", "Pain, fruits, quelque chose de simple", "Perso"],
  ].map(([time, title, note, tag]) => ({
    id: uid(),
    date: todayKey,
    time,
    title,
    note,
    tag,
  }));

  const tasks = [
    ["Envoyer le compte-rendu du point de vendredi", true],
    ["Préparer les questions de l’entretien de 14 h", false],
    ["Relire les retours de l’équipe design", false],
    ["Bloquer jeudi matin pour écrire", false],
    ["Acheter du pain et des fruits", true],
  ].map(([text, done]) => ({ id: uid(), text, done }));

  const goals = [
    ["Clarifier le périmètre de la prochaine version", false],
    ["Mener deux entretiens utilisateurs cette semaine", false],
    ["Avancer de quinze pages dans le livre en cours", true],
    ["Préparer le menu de la semaine", false],
  ].map(([text, done]) => ({ id: uid(), text, done }));

  return { version: 1, theme: "dark", events, tasks, habits, goals };
}

function sanitize(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("format");
  }
  if (!Array.isArray(data.events) || !Array.isArray(data.tasks) || !Array.isArray(data.habits) || !Array.isArray(data.goals)) {
    throw new Error("format");
  }
  return {
    version: 1,
    theme: data.theme === "light" ? "light" : "dark",
    events: data.events.slice(0, 400).map(cleanEvent).filter(Boolean),
    tasks: data.tasks.slice(0, 400).map((item) => cleanTextItem(item, "text")).filter(Boolean),
    habits: data.habits.slice(0, 200).map(cleanHabit).filter(Boolean),
    goals: data.goals.slice(0, 200).map((item) => cleanTextItem(item, "text")).filter(Boolean),
  };
}

function cleanEvent(item) {
  if (!item || typeof item !== "object") return null;
  const time = normTime(item.time);
  const date = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : iso(new Date());
  if (!time) return null;
  return {
    id: cleanId(item.id),
    date,
    time,
    title: cleanString(item.title, 200),
    note: cleanString(item.note, 300),
    tag: TAGS.includes(item.tag) ? item.tag : "Travail",
  };
}

function cleanTextItem(item, key) {
  if (!item || typeof item !== "object") return null;
  return {
    id: cleanId(item.id),
    text: cleanString(item[key], 200),
    done: Boolean(item.done),
  };
}

function cleanHabit(item) {
  if (!item || typeof item !== "object") return null;
  const history = {};
  if (item.history && typeof item.history === "object" && !Array.isArray(item.history)) {
    for (const [date, value] of Object.entries(item.history)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && value) history[date] = true;
    }
  }
  return {
    id: cleanId(item.id),
    name: cleanString(item.name, 120),
    history,
  };
}

function cleanId(id) {
  return typeof id === "string" && id.length > 0 && id.length < 80 ? id : uid();
}

function cleanString(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}

function collection(kind) {
  return { event: state.events, task: state.tasks, habit: state.habits, goal: state.goals }[kind];
}

function findItem(kind, id) {
  return collection(kind).find((item) => item.id === id);
}

function renderAll() {
  renderAgenda();
  renderTasks();
  renderHabits();
  renderGoals();
  refreshClock();
}

function renderAgenda() {
  const events = classify(todayEvents(), new Date());
  fill(els.agenda, events.map(renderEvent));
  els.agendaEmpty.hidden = events.length > 0;
  els.agendaEmpty.replaceChildren();
  if (events.length === 0) {
    els.agendaEmpty.append(h("p", { text: "Aucun créneau pour aujourd’hui. Ajoutez le premier ci-dessous." }));
    const previous = previousDate();
    if (previous) {
      els.agendaEmpty.append(h("button", {
        type: "button",
        class: "text-btn",
        "data-action": "copy-previous",
        text: `Reprendre ceux du ${formatDay(previous)}`,
      }));
    }
  }
  updateStats();
}

function renderEvent(event) {
  const row = h("li", {
    class: `event${event.status === "now" ? " is-now" : ""}${event.status === "past" ? " is-past" : ""}`,
    "data-kind": "event",
    "data-id": event.id,
    "data-time": event.time,
    "data-tag": event.tag,
  });
  row.append(
    h("div", { class: "rail", "aria-hidden": "true" }, [h("span")]),
    h("div", { class: "event-body" }, [
      h("div", { class: "event-top" }, [
        h("input", {
          class: "time",
          type: "text",
          inputmode: "numeric",
          value: event.time,
          "data-field": "time",
          "aria-label": "Heure, par exemple 14:30",
          maxlength: "8",
          spellcheck: "false",
          autocomplete: "off",
        }),
        h("select", { "data-field": "tag", "aria-label": "Catégorie" }, TAGS.map((tag) => {
          const option = h("option", { value: tag, text: tag });
          if (tag === event.tag) option.selected = true;
          return option;
        })),
        h("span", { class: "now-flag", text: "En cours" }),
      ]),
      h("textarea", {
        class: "ghost title",
        rows: "1",
        value: event.title,
        "data-field": "title",
        "aria-label": "Intitulé",
        maxlength: "200",
      }),
      h("textarea", {
        class: "ghost note",
        rows: "1",
        value: event.note,
        "data-field": "note",
        "aria-label": "Note",
        maxlength: "300",
        placeholder: "Ajouter une note",
      }),
    ]),
    removeButton("Supprimer ce créneau"),
  );
  return row;
}

function renderTasks() {
  fill(els.tasks, state.tasks.map((task) => renderCheckRow("task", task, "tâche", "Supprimer cette tâche")));
  els.taskEmpty.hidden = state.tasks.length > 0;
  updateStats();
}

function renderGoals() {
  fill(els.goals, state.goals.map((goal) => renderCheckRow("goal", goal, "objectif", "Supprimer cet objectif")));
  els.goalEmpty.hidden = state.goals.length > 0;
  updateStats();
}

function renderCheckRow(kind, item, label, removeLabel) {
  const row = h("li", {
    class: `${kind}${item.done ? " is-done" : ""}`,
    "data-kind": kind,
    "data-id": item.id,
  });
  const box = h("input", {
    class: "check",
    type: "checkbox",
    "data-field": "done",
    "aria-label": `Marquer ${label === "tâche" ? "cette tâche" : "cet objectif"} comme fait`,
  });
  box.checked = item.done;
  row.append(
    box,
    h("textarea", {
      class: "ghost",
      rows: "1",
      value: item.text,
      "data-field": "text",
      "aria-label": label === "tâche" ? "Texte de la tâche" : "Texte de l’objectif",
      maxlength: "200",
    }),
    removeButton(removeLabel),
  );
  return row;
}

function renderHabits() {
  const today = iso(new Date());
  const days = recentDays(6);
  fill(els.habits, state.habits.map((habit) => {
    const row = h("li", { class: "habit", "data-kind": "habit", "data-id": habit.id });
    const box = h("input", { class: "check", type: "checkbox", "data-field": "today", "aria-label": "Fait aujourd’hui" });
    box.checked = Boolean(habit.history[today]);
    const count = streak(habit);
    row.append(
      h("textarea", {
        class: "ghost",
        rows: "1",
        value: habit.name,
        "data-field": "name",
        "aria-label": "Nom de l’habitude",
        maxlength: "120",
      }),
      h("span", { class: "streak", text: count ? `${count} ${count > 1 ? "jours" : "jour"}` : "" }),
      removeButton("Supprimer cette habitude"),
      h("div", { class: "week" }, days.map((date) => {
        const key = iso(date);
        const on = Boolean(habit.history[key]);
        const label = `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;
        return h("button", {
          type: "button",
          class: `day${on ? " is-on" : ""}`,
          "data-action": "toggle-day",
          "data-date": key,
          "aria-pressed": on ? "true" : "false",
          "aria-label": `${on ? "Fait" : "Pas fait"} le ${formatDay(key)}`,
          title: formatDay(key),
        }, [
          h("span", { class: "pip", "aria-hidden": "true" }),
          h("span", { class: "day-label", text: label }),
        ]);
      })),
      h("label", { class: "today" }, [
        box,
        h("span", { text: "Aujourd’hui" }),
      ]),
    );
    return row;
  }));
  els.habitEmpty.hidden = state.habits.length > 0;
  updateStats();
}

function removeButton(label) {
  return h("button", { type: "button", class: "icon-btn", "data-action": "delete", "aria-label": label }, [
    h("span", { "aria-hidden": "true", text: "×" }),
  ]);
}

function writeField(field) {
  const row = field.closest("[data-kind]");
  if (!row) return;
  const item = findItem(row.dataset.kind, row.dataset.id);
  if (!item) return;
  const key = field.dataset.field;

  if (field.type === "checkbox") {
    if (key === "today") {
      const date = iso(new Date());
      if (field.checked) item.history[date] = true;
      else delete item.history[date];
      save();
      renderHabits();
      return;
    }
    item.done = field.checked;
    row.classList.toggle("is-done", field.checked);
    save();
    updateStats();
    return;
  }

  if (key === "time") {
    const time = normTime(field.value);
    if (!time) {
      field.value = item.time;
      return;
    }
    if (time === item.time) {
      field.value = time;
      return;
    }
    item.time = time;
    sortEvents();
    save();
    renderAgenda();
    refreshClock();
    return;
  }

  if (key === "tag") {
    item.tag = TAGS.includes(field.value) ? field.value : "Travail";
    row.dataset.tag = item.tag;
    save();
    return;
  }

  item[key] = field.value;
  save();
  if (key === "title") refreshClock();
}

function addItem(form) {
  const data = new FormData(form);
  const kind = form.dataset.add;
  if (kind === "event") {
    const time = normTime(data.get("time"));
    const title = String(data.get("title") || "").trim();
    if (!time || !title) return;
    state.events.push({
      id: uid(),
      date: iso(new Date()),
      time,
      title: title.slice(0, 200),
      note: String(data.get("note") || "").trim().slice(0, 300),
      tag: TAGS.includes(data.get("tag")) ? data.get("tag") : "Travail",
    });
    sortEvents();
    form.elements.title.value = "";
    form.elements.note.value = "";
    form.elements.time.value = nextHour();
    save();
    renderAgenda();
    refreshClock();
    form.elements.title.focus();
    return;
  }

  if (kind === "habit") {
    const name = String(data.get("name") || "").trim();
    if (!name) return;
    state.habits.push({ id: uid(), name: name.slice(0, 120), history: {} });
    form.elements.name.value = "";
    save();
    renderHabits();
    form.elements.name.focus();
    return;
  }

  const text = String(data.get("text") || "").trim();
  if (!text) return;
  collection(kind).push({ id: uid(), text: text.slice(0, 200), done: false });
  form.elements.text.value = "";
  save();
  if (kind === "task") renderTasks();
  else renderGoals();
  form.elements.text.focus();
}

function deleteItem(kind, id) {
  const items = collection(kind);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;
  items.splice(index, 1);
  save();
  if (kind === "event") {
    renderAgenda();
    refreshClock();
  } else if (kind === "task") renderTasks();
  else if (kind === "habit") renderHabits();
  else renderGoals();
}

function toggleHabitDay(id, date) {
  const habit = findItem("habit", id);
  if (!habit || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return;
  if (habit.history[date]) delete habit.history[date];
  else habit.history[date] = true;
  save();
  renderHabits();
}

function copyPreviousDay() {
  const source = previousDate();
  if (!source) return;
  const today = iso(new Date());
  state.events
    .filter((event) => event.date === source)
    .forEach((event) => {
      state.events.push({ ...event, id: uid(), date: today });
    });
  sortEvents();
  save();
  renderAgenda();
  refreshClock();
  toast("Créneaux repris pour aujourd’hui.");
}

function previousDate() {
  const today = iso(new Date());
  return state.events
    .map((event) => event.date)
    .filter((date) => date < today)
    .sort()
    .at(-1) || null;
}

function todayEvents() {
  const today = iso(new Date());
  return state.events
    .filter((event) => event.date === today)
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title, "fr"));
}

function sortEvents() {
  state.events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

function classify(events, now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  let currentTime = null;
  events.forEach((event) => {
    if (toMinutes(event.time) <= minutes) currentTime = event.time;
  });
  return events.map((event) => ({
    ...event,
    status: currentTime == null ? "next" : event.time < currentTime ? "past" : event.time === currentTime ? "now" : "next",
  }));
}

function refreshClock() {
  const now = new Date();
  const events = classify(todayEvents(), now);
  els.today.textContent = formatDate(now);
  els.greeting.textContent = greeting(now);
  els.nowLine.textContent = statusLine(events);
  document.title = `${formatDate(now)} — Tableau de bord`;
  document.querySelectorAll("#agenda-list .event").forEach((row) => {
    const event = events.find((item) => item.id === row.dataset.id);
    row.classList.toggle("is-now", Boolean(event && event.status === "now"));
    row.classList.toggle("is-past", Boolean(event && event.status === "past"));
  });
}

function statusLine(events) {
  const current = events.find((event) => event.status === "now");
  const next = events.find((event) => event.status === "next");
  if (current) return `En cours · ${formatTimeFr(current.time)} ${current.title}`;
  if (next) {
    const started = events.some((event) => event.status === "past");
    return `${started ? "Ensuite" : "À venir"} · ${formatTimeFr(next.time)} ${next.title}`;
  }
  if (events.length === 0) return "Aucun créneau pour le moment.";
  return "La journée est posée.";
}

function updateStats() {
  const events = todayEvents();
  const tasksDone = state.tasks.filter((task) => task.done).length;
  const today = iso(new Date());
  const habitsDone = state.habits.filter((habit) => habit.history[today]).length;
  const goalsDone = state.goals.filter((goal) => goal.done).length;

  setCount("event-count", events.length === 1 ? "1 créneau" : `${events.length} créneaux`, `${events.length} créneaux aujourd’hui`);
  setCount("task-count", `${tasksDone} / ${state.tasks.length}`, `${tasksDone} tâches faites sur ${state.tasks.length}`);
  setCount("habit-count", `${habitsDone} / ${state.habits.length}`, `${habitsDone} habitudes faites aujourd’hui sur ${state.habits.length}`);
  setCount("goal-count", `${goalsDone} / ${state.goals.length}`, `${goalsDone} objectifs atteints sur ${state.goals.length}`);

  document.getElementById("stat-events").textContent = String(events.length);
  document.getElementById("stat-tasks").textContent = `${tasksDone}/${state.tasks.length}`;
  document.getElementById("stat-habits").textContent = `${habitsDone}/${state.habits.length}`;

  const max = state.goals.length;
  els.goalBarWrap.hidden = max === 0;
  els.goalBarWrap.setAttribute("aria-valuemax", String(max));
  els.goalBarWrap.setAttribute("aria-valuenow", String(goalsDone));
  els.goalBar.style.width = max ? `${(goalsDone / max) * 100}%` : "0%";
}

function setCount(id, text, label) {
  const node = document.getElementById(id);
  node.textContent = text;
  node.setAttribute("aria-label", label);
}

function applyTheme() {
  const dark = state.theme !== "light";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  els.theme.setAttribute("aria-pressed", dark ? "true" : "false");
  els.theme.textContent = dark ? "Mode clair" : "Mode sombre";
  els.themeColor.setAttribute("content", dark ? "#12110f" : "#efe7db");
}

function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    theme: state.theme,
    events: state.events,
    tasks: state.tasks,
    habits: state.habits,
    goals: state.goals,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: `tableau-de-bord-${iso(new Date())}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Fichier JSON téléchargé.");
}

function onImportFile(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  if (file.size > 2000000) {
    toast("Ce fichier est trop volumineux.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || "").replace(/^\uFEFF/, "");
      pendingImport = sanitize(JSON.parse(text));
      openDialog();
    } catch (err) {
      pendingImport = null;
      toast("Ce fichier ne correspond pas à une sauvegarde du tableau de bord.");
    }
  };
  reader.onerror = () => toast("Impossible de lire ce fichier.");
  reader.readAsText(file);
}

function openDialog() {
  lastFocus = document.activeElement;
  els.dialog.hidden = false;
  document.getElementById("dialog-cancel").focus();
}

function closeDialog() {
  els.dialog.hidden = true;
  pendingImport = null;
  if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
}

function confirmImport() {
  if (!pendingImport) return;
  state.theme = pendingImport.theme;
  state.events = pendingImport.events;
  state.tasks = pendingImport.tasks;
  state.habits = pendingImport.habits;
  state.goals = pendingImport.goals;
  pendingImport = null;
  save();
  applyTheme();
  renderAll();
  els.dialog.hidden = true;
  toast("Données restaurées.");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove("is-on"), 2800);
}

function streak(habit) {
  let count = 0;
  let cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  if (!habit.history[iso(cursor)]) cursor = addDays(cursor, -1);
  while (habit.history[iso(cursor)]) {
    count += 1;
    cursor = addDays(cursor, -1);
    if (count > 400) break;
  }
  return count;
}

function recentDays(count) {
  const days = [];
  for (let offset = count; offset >= 1; offset -= 1) days.push(addDays(new Date(), -offset));
  return days;
}

function greeting(date) {
  const hour = date.getHours();
  if (hour < 5) return "Bonne nuit.";
  if (hour < 12) return "Bonjour.";
  if (hour < 18) return "Bon après-midi.";
  return "Bonsoir.";
}

function formatDate(date) {
  const text = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  return text.charAt(0).toLocaleUpperCase("fr-FR") + text.slice(1);
}

function formatDay(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(year, month - 1, day));
}

function formatTimeFr(time) {
  const [hour, minute] = time.split(":");
  return `${Number(hour)} h ${minute}`;
}

function nextHour() {
  const date = new Date();
  const hour = (date.getHours() + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00`;
}

function toMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function normTime(value) {
  const match = /^(\d{1,2})\s*(?:h|:)\s*(\d{2})$/i.exec(String(value || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function autosize(node) {
  if (!node || node.tagName !== "TEXTAREA") return;
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

function fill(node, children) {
  node.replaceChildren(...children);
  node.querySelectorAll("textarea").forEach(autosize);
}

function iso(date) {
  const copy = new Date(date);
  const month = String(copy.getMonth() + 1).padStart(2, "0");
  const day = String(copy.getDate()).padStart(2, "0");
  return `${copy.getFullYear()}-${month}-${day}`;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function h(tag, props, children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "value") node.value = String(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child) node.append(child);
  });
  return node;
}
