const API = "";

let _allFiles = [];

const recentSorter = makeSorter("date", "desc");

function recentValue(f, col) {
  switch (col) {
    case "name":      return f.name.toLowerCase();
    case "type":      return classifyFile(f.mime_type || "").label;
    case "size":      return f.size;
    case "provider":  return (f.providers || []).join(",");
    case "encrypted": return f.is_encrypted ? 1 : 0;
    case "date":      return f.created_at || "";
    default:          return "";
  }
}

const SIZE_BUCKETS = [
  { label: "Tiny",   desc: "< 1 KB",       color: "#a29bfe", test: (b) => b < 1024 },
  { label: "Small",  desc: "1 KB – 1 MB",  color: "#6c63ff", test: (b) => b < 1024 ** 2 },
  { label: "Medium", desc: "1 – 100 MB",   color: "#45b7d1", test: (b) => b < 100 * 1024 ** 2 },
  { label: "Large",  desc: "> 100 MB",     color: "#ff6b6b", test: () => true },
];

async function loadDashboard() {
  const [filesRes, providersRes] = await Promise.all([
    fetch(`${API}/files`),
    fetch(`${API}/providers`),
  ]);
  _allFiles = await filesRes.json();
  const providers = await providersRes.json();

  renderOverview(_allFiles, providers);
  renderStorage(providers);
  renderFileTypes(_allFiles);
  renderSizeDist(_allFiles);
  renderRecent(_allFiles);
}

// ── Overview ──────────────────────────────────────────────────────────────────

function renderOverview(files, providers) {
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const encCount = files.filter((f) => f.is_encrypted).length;
  const activeProviders = providers.filter((p) => p.available).length;
  const gdriveCount = files.filter((f) => (f.providers || []).includes("google_drive")).length;
  const tgCount = files.filter((f) => (f.providers || []).includes("telegram")).length;

  set("s-total", files.length);
  set("s-size", formatBytes(totalSize));
  set("s-enc", encCount === 0 ? "0" : `${encCount} / ${files.length}`);
  set("s-providers", `${activeProviders} / ${providers.length}`);
  set("s-gdrive", gdriveCount);
  set("s-telegram", tgCount);
}

// ── Storage detail ────────────────────────────────────────────────────────────

function renderStorage(providers) {
  const el = document.getElementById("storage-detail");
  if (!providers.length) { el.innerHTML = `<p class="muted-text">No providers configured.</p>`; return; }

  el.innerHTML = providers.map((p) => {
    const label = PROVIDER_LABELS[p.name] || p.name;
    const pct = p.capacity_bytes > 0 ? Math.round((p.used_bytes / p.capacity_bytes) * 100) : 0;
    const statusTag = p.available
      ? `<span class="dash-tag available">Active</span>`
      : `<span class="dash-tag unavailable">Not configured</span>`;

    return `
    <div class="storage-row">
      <div class="storage-row-header">
        <span class="storage-name">${label}</span>
        ${statusTag}
      </div>
      <div class="storage-numbers">
        <span>${formatBytes(p.used_bytes)} used</span>
        <span style="color:var(--muted)">${formatBytes(p.free_bytes)} free</span>
        <span style="color:var(--muted)">${formatBytes(p.capacity_bytes)} total</span>
      </div>
      <div class="progress" style="height:8px;margin-top:.4rem">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
      <div style="font-size:.75rem;color:var(--muted);margin-top:.25rem">${pct}% used</div>
    </div>`;
  }).join('<div class="storage-divider"></div>');
}

// ── File type donut ───────────────────────────────────────────────────────────

function renderFileTypes(files) {
  const counts = Object.fromEntries(FILE_TYPES.map((t) => [t.label, 0]));
  files.forEach((f) => { counts[classifyFile(f.mime_type || "").label]++; });

  const data = FILE_TYPES.map((t) => ({ ...t, value: counts[t.label] })).filter((d) => d.value > 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  document.getElementById("donut-chart").innerHTML = buildDonut(data, total);
  document.getElementById("donut-legend").innerHTML = data.map((d) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${d.color}"></span>
      <span class="legend-label">${d.label}</span>
      <span class="legend-count">${d.value}</span>
    </div>`).join("");
}

// ── Size distribution ─────────────────────────────────────────────────────────

function renderSizeDist(files) {
  const counts = SIZE_BUCKETS.map((b) => ({ ...b, count: 0, size: 0 }));
  files.forEach((f) => {
    const bucket = counts.find((b) => b.test(f.size));
    if (bucket) { bucket.count++; bucket.size += f.size; }
  });

  const max = Math.max(...counts.map((b) => b.count), 1);
  document.getElementById("size-dist").innerHTML = counts.map((b) => `
    <div class="chart-row">
      <div class="chart-label" style="width:110px">
        <div style="font-size:.82rem">${b.label}</div>
        <div style="font-size:.72rem;color:var(--muted)">${b.desc}</div>
      </div>
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="width:${b.count === 0 ? 0 : Math.max(4, Math.round((b.count / max) * 100))}%;background:${b.color}"></div>
      </div>
      <div class="chart-count">${b.count} file${b.count !== 1 ? "s" : ""}<br><span style="font-size:.7rem;color:var(--muted)">${formatBytes(b.size)}</span></div>
    </div>`).join("");
}

// ── Recent uploads ────────────────────────────────────────────────────────────

function renderRecent(files) {
  const tbody = document.getElementById("recent-tbody");
  const sorted = recentSorter.sort(files, recentValue).slice(0, 15);
  recentSorter.updateHeaders();

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No files yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((f) => {
    const type = classifyFile(f.mime_type || "");
    const badges = (f.providers || [])
      .map((p) => `<span class="badge">${PROVIDER_LABELS[p] || p}</span>`)
      .join(" ");
    const enc = f.is_encrypted
      ? `<span class="dash-tag available">🔒 Yes</span>`
      : `<span class="dash-tag unavailable">No</span>`;
    return `
    <tr>
      <td>${escHtml(f.name)}</td>
      <td><span class="type-dot" style="background:${type.color}"></span>${type.label}</td>
      <td>${formatBytes(f.size)}</td>
      <td>${badges}</td>
      <td>${enc}</td>
      <td>${f.created_at ? f.created_at.slice(0, 10) : "—"}</td>
    </tr>`;
  }).join("");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

initTheme();
recentSorter.attachHeaders(document, () => renderRecent(_allFiles));
loadDashboard();
