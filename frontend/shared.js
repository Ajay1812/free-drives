// Shared utilities used by both index.html and dashboard.html

const PROVIDER_LABELS = {
  google_drive: "Google Drive",
  telegram: "Telegram",
};

const FILE_TYPES = [
  { label: "Images",    color: "#ff6b6b", test: (m) => m.startsWith("image/") },
  { label: "Videos",    color: "#45b7d1", test: (m) => m.startsWith("video/") },
  { label: "Audio",     color: "#f9ca24", test: (m) => m.startsWith("audio/") },
  { label: "Documents", color: "#6c63ff", test: (m) => ["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"].includes(m) },
  { label: "Sheets",    color: "#00b894", test: (m) => m.includes("spreadsheet") || m.includes("excel") || m === "text/csv" },
  { label: "Archives",  color: "#a29bfe", test: (m) => ["application/zip","application/x-rar-compressed","application/x-7z-compressed","application/gzip","application/x-tar"].includes(m) },
  { label: "Code",      color: "#fd79a8", test: (m) => ["text/html","text/css","text/javascript","application/json","application/xml","text/xml"].includes(m) },
  { label: "Other",     color: "#636e72", test: () => true },
];

function formatBytes(b) {
  if (!b || b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / 1024 ** i).toFixed(1) + " " + units[i];
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function classifyFile(mime) {
  return FILE_TYPES.find((t) => t.test(mime)) || FILE_TYPES[FILE_TYPES.length - 1];
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "light" ? "🌙" : "☀️";
  localStorage.setItem("theme", theme);
}

function initTheme() {
  applyTheme(localStorage.getItem("theme") || "dark");
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.addEventListener("click", () => {
      applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
    });
  }
}

// ── Sort helpers ─────────────────────────────────────────────────────────────

function makeSorter(defaultCol = "date", defaultDir = "desc") {
  let col = defaultCol, dir = defaultDir;

  function toggle(newCol) {
    if (col === newCol) dir = dir === "asc" ? "desc" : "asc";
    else { col = newCol; dir = "asc"; }
  }

  function sort(arr, getValue) {
    return [...arr].sort((a, b) => {
      const va = getValue(a, col), vb = getValue(b, col);
      if (va < vb) return dir === "asc" ? -1 : 1;
      if (va > vb) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }

  function updateHeaders(scope = document) {
    scope.querySelectorAll("th[data-sort]").forEach((th) => {
      const icon = th.querySelector(".sort-icon");
      if (!icon) return;
      const isActive = th.dataset.sort === col;
      th.classList.toggle("sort-active", isActive);
      icon.textContent = isActive ? (dir === "asc" ? " ↑" : " ↓") : " ↕";
    });
  }

  function attachHeaders(scope = document, onSort) {
    scope.querySelectorAll("th[data-sort]").forEach((th) => {
      th.classList.add("sortable");
      th.addEventListener("click", () => { toggle(th.dataset.sort); onSort(); });
    });
    updateHeaders(scope);
  }

  return { sort, attachHeaders, updateHeaders, get col() { return col; }, get dir() { return dir; } };
}

// SVG donut chart — returns an SVG string given [{label, color, value}]
function buildDonut(data, total) {
  const r = 52, cx = 70, cy = 70, strokeW = 18;
  const circ = 2 * Math.PI * r;
  if (total === 0) return `<svg width="140" height="140"><text x="70" y="75" text-anchor="middle" fill="var(--muted)" font-size="12">No files</text></svg>`;

  let offset = 0;
  const segments = data
    .filter((d) => d.value > 0)
    .map((d) => {
      const dash = (d.value / total) * circ;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}"
        stroke-width="${strokeW}" stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="butt"/>`;
      offset += dash;
      return seg;
    });

  return `
  <svg width="140" height="140" style="transform:rotate(-90deg);display:block">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"/>
    ${segments.join("")}
  </svg>`;
}
