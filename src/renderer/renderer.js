// The UI. Runs sandboxed — it can only reach the main process through the
// `window.api` object that the preload set up. No Node, no fs, no exec here.

const $ = (id) => document.getElementById(id);

// ---- clock / stardate ----
function tickClock() {
  const now = new Date();
  $("clock").textContent = now
    .toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
}
setInterval(tickClock, 1000 * 30);
tickClock();

// ---- Docker widget ----
async function loadDocker() {
  const res = await window.api.docker.list();
  const body = $("docker-body");
  const pip = $("docker-pip");

  if (!res.ok) {
    body.innerHTML = `<p class="muted">${res.reason}. Start Docker to see services.</p>`;
    pip.className = "pip alert";
    return;
  }
  if (res.containers.length === 0) {
    body.innerHTML = `<p class="muted">No containers. Run something to see it here.</p>`;
    pip.className = "pip";
    return;
  }

  const anyRunning = res.containers.some((c) => c.state === "running");
  pip.className = anyRunning ? "pip live" : "pip";

  body.innerHTML = res.containers
    .map((c) => {
      const running = c.state === "running";
      return `<div class="row">
        <span class="dot ${running ? "running" : ""}"></span>
        <span class="name">${c.name}</span>
        <span class="status">${c.status}</span>
      </div>`;
    })
    .join("");
}

// ---- Daily note widget ----
// A tiny markdown renderer — just enough for headings, bullets, and tasks.
function renderMarkdown(md) {
  const lines = md.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)/);
    const task = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/);
    const bullet = line.match(/^\s*[-*]\s+(.*)/);

    if (h) {
      if (inList) (html += "</ul>"), (inList = false);
      html += `<h3>${escape(h[2])}</h3>`;
    } else if (task) {
      if (!inList) (html += "<ul>"), (inList = true);
      const done = task[1] === "x";
      html += `<li class="${done ? "task-done" : ""}">${
        done ? "✓" : "○"
      } ${escape(task[2])}</li>`;
    } else if (bullet) {
      if (!inList) (html += "<ul>"), (inList = true);
      html += `<li>${escape(bullet[1])}</li>`;
    } else {
      if (inList) (html += "</ul>"), (inList = false);
      if (line.trim()) html += `<p>${escape(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html || '<p class="muted">Note is empty.</p>';
}
function escape(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

async function loadDaily() {
  const res = await window.api.grimoire.dailyNote();
  const body = $("daily-body");
  const dateTag = $("daily-date");
  const fname = res.file.split("/").pop().replace(".md", "");
  dateTag.textContent = fname;

  if (!res.ok) {
    body.innerHTML = `<p class="muted">${res.reason}. It'll appear once you create today's note.</p>`;
    return;
  }
  body.innerHTML = `<div class="note">${renderMarkdown(res.content)}</div>`;
}

// ---- Missions widget ----
async function loadMissions() {
  const res = await window.api.grimoire.missions();
  const body = $("missions-body");

  if (!res.ok) {
    body.innerHTML = `<p class="muted">${res.reason}.</p>`;
    return;
  }
  if (res.missions.length === 0) {
    body.innerHTML = `<p class="muted">No missions yet.</p>`;
    return;
  }
  body.innerHTML = res.missions
    .map((m) => {
      const when = new Date(m.modified).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      return `<div class="row">
        <span class="dot running"></span>
        <span class="name">${escape(m.name)}</span>
        <span class="status">${when}</span>
      </div>`;
    })
    .join("");
}

// ---- Todoist widget ----
function dueLabel(dateStr, overdue) {
  if (!dateStr) return "";
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  if (overdue) {
    const days = Math.round((new Date(today) - new Date(dateStr)) / 86400000);
    return days === 1 ? "Yesterday" : `${days}d overdue`;
  }
  return dateStr;
}

async function loadTodoist() {
  const res = await window.api.todoist.tasks();
  const body = $("todoist-body");
  const pip = $("todoist-pip");

  if (!res.ok) {
    body.innerHTML = `<p class="muted">${res.reason}.</p>`;
    pip.className = "pip alert";
    return;
  }
  if (res.tasks.length === 0) {
    body.innerHTML = `<p class="muted">Nothing due. Clear runway.</p>`;
    pip.className = "pip";
    return;
  }

  pip.className = res.tasks.some((t) => t.overdue) ? "pip alert" : "pip live";

  body.innerHTML = res.tasks
    .map(
      (t) => `<div class="row">
        <span class="dot ${t.overdue ? "alert" : "running"}"></span>
        <span class="name">${escape(t.content)}</span>
        <span class="status">${dueLabel(t.due, t.overdue)}</span>
      </div>`
    )
    .join("");
}

// ---- SillyTavern launcher (from config) ----
function loadSillyTavern(config) {
  const body = $("st-body");
  const instances = config.sillytavern?.instances || [];
  if (instances.length === 0) {
    body.innerHTML = `<p class="muted">No instances configured.</p>`;
    return;
  }
  body.innerHTML = instances
    .map(
      (i) =>
        `<button class="launch" data-url="${i.url}">
          <span>${escape(i.label)}</span>
          <span class="arrow">${i.url.replace("http://", "")} →</span>
        </button>`
    )
    .join("");

  body.querySelectorAll(".launch").forEach((btn) => {
    btn.addEventListener("click", () => window.api.openUrl(btn.dataset.url));
  });
}

// ---- Claude Code launcher (from config) ----
function loadClaude(config) {
  const body = $("claude-body");
  const projects = config.claudeCode?.projects || [];
  if (projects.length === 0) {
    body.innerHTML = `<p class="muted">No projects configured.</p>`;
    return;
  }
  body.innerHTML = projects
    .map(
      (p) =>
        `<button class="launch" data-path="${p.path}">
          <span>${escape(p.label)}</span>
          <span class="arrow">launch →</span>
        </button>`
    )
    .join("");

  body.querySelectorAll(".launch").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.querySelector(".arrow").textContent = "opening…";
      const res = await window.api.claude.launch(btn.dataset.path);
      btn.querySelector(".arrow").textContent = res.ok ? "opened ✓" : "failed";
      setTimeout(() => {
        btn.querySelector(".arrow").textContent = "launch →";
      }, 2000);
    });
  });
}

// ---- boot ----
async function boot() {
  const config = await window.api.getConfig();
  loadSillyTavern(config);
  loadClaude(config);
  await Promise.all([loadDocker(), loadDaily(), loadMissions(), loadTodoist()]);

  // periodic Docker refresh
  const secs = config.docker?.refreshSeconds || 15;
  setInterval(loadDocker, secs * 1000);
}

$("refresh-all").addEventListener("click", async () => {
  await Promise.all([loadDocker(), loadDaily(), loadMissions(), loadTodoist()]);
});

boot();
