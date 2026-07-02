const API = "";
const PAGE_SIZE = 20;
const UPLOAD_CONCURRENCY = 3;

let _files = [];
let _page = 1;
let _selectedIds = new Set();

// Upload queue state
let _uploadFiles = [];
let _uploadStates = [];

// Session passphrase (in-memory only, cleared on tab close)
let _sessionPassphrase = null;

// Cancel-support: track active XHR and upload_id per queue index
const _activeXHRs = {};
const _uploadIds  = {};

const fileSorter = makeSorter("date", "desc");

function fileValue(f, col) {
  switch (col) {
    case "name":     return f.name.toLowerCase();
    case "size":     return f.size;
    case "provider": return (f.providers || []).join(",");
    case "date":     return f.created_at || "";
    default:         return "";
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  const [filesRes, providersRes] = await Promise.all([
    fetch(`${API}/files`),
    fetch(`${API}/providers`),
  ]);
  _files = await filesRes.json();
  const providers = await providersRes.json();
  renderProviders(providers);
  _page = 1;
  renderTable();
}

// ── Providers ─────────────────────────────────────────────────────────────────

function renderProviders(providers) {
  document.getElementById("provider-bar").innerHTML = providers.map((p) => {
    const pct = p.capacity_bytes > 0 ? Math.round((p.used_bytes / p.capacity_bytes) * 100) : 0;
    const label = PROVIDER_LABELS[p.name] || p.name;
    const tag = p.available ? "" : '<span class="not-configured">· not configured</span>';
    return `
    <div class="provider-card ${p.available ? "" : "disabled"}">
      <div class="provider-name">${label} ${tag}</div>
      <div class="provider-stats">${formatBytes(p.free_bytes)} free / ${formatBytes(p.capacity_bytes)}</div>
      <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");

  const select = document.getElementById("provider-select");
  const current = select.value;
  select.innerHTML = `<option value="">Auto (waterfall)</option>`;
  providers.filter((p) => p.available).forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = PROVIDER_LABELS[p.name] || p.name;
    select.appendChild(opt);
  });
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderTable() {
  const sorted = fileSorter.sort(_files, fileValue);
  fileSorter.updateHeaders();

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if (_page > totalPages) _page = totalPages;

  const start = (_page - 1) * PAGE_SIZE;
  const pageFiles = sorted.slice(start, start + PAGE_SIZE);
  const pageIds = new Set(pageFiles.map((f) => f.id));

  window.FILE_CACHE = Object.fromEntries(sorted.map((f) => [f.id, f]));

  const tbody = document.getElementById("file-tbody");
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No files yet. Upload something!</td></tr>`;
    renderPagination(0, 0);
    renderBulkBar();
    return;
  }

  tbody.innerHTML = pageFiles.map((f) => {
    const checked = _selectedIds.has(f.id) ? "checked" : "";
    const badges = (f.providers || [])
      .map((p) => `<span class="badge">${PROVIDER_LABELS[p] || p}</span>`)
      .join(" ");
    return `
    <tr class="${_selectedIds.has(f.id) ? "row-selected" : ""}">
      <td class="col-check"><input type="checkbox" ${checked} onchange="toggleSelect(${f.id})" /></td>
      <td>${escHtml(f.name)}</td>
      <td>${formatBytes(f.size)}</td>
      <td>${badges}</td>
      <td>${f.created_at ? f.created_at.slice(0, 10) : ""}</td>
      <td>
        <button class="btn-sm" onclick="downloadFile(${f.id})">Download</button>
        <button class="btn-sm danger" onclick="deleteSingle(${f.id})">Delete</button>
      </td>
    </tr>`;
  }).join("");

  const selAll = document.getElementById("select-all");
  const pageSelected = [...pageIds].filter((id) => _selectedIds.has(id));
  selAll.checked = pageSelected.length === pageIds.size && pageIds.size > 0;
  selAll.indeterminate = pageSelected.length > 0 && pageSelected.length < pageIds.size;

  renderPagination(sorted.length, totalPages);
  renderBulkBar();
}

// ── Pagination ────────────────────────────────────────────────────────────────

function renderPagination(total, totalPages) {
  const el = document.getElementById("pagination");
  if (totalPages <= 1) { el.innerHTML = ""; return; }

  const start = (_page - 1) * PAGE_SIZE + 1;
  const end = Math.min(_page * PAGE_SIZE, total);

  let nums = [];
  if (totalPages <= 7) {
    nums = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else if (_page <= 4) {
    nums = [1, 2, 3, 4, 5, "…", totalPages];
  } else if (_page >= totalPages - 3) {
    nums = [1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  } else {
    nums = [1, "…", _page - 1, _page, _page + 1, "…", totalPages];
  }

  el.innerHTML = `
    <div class="page-info">Showing ${start}–${end} of ${total} files</div>
    <div class="page-controls">
      <button class="page-btn" onclick="goPage(${_page - 1})" ${_page === 1 ? "disabled" : ""}>‹ Prev</button>
      ${nums.map((n) =>
        n === "…"
          ? `<span class="page-ellipsis">…</span>`
          : `<button class="page-btn ${n === _page ? "active" : ""}" onclick="goPage(${n})">${n}</button>`
      ).join("")}
      <button class="page-btn" onclick="goPage(${_page + 1})" ${_page === totalPages ? "disabled" : ""}>Next ›</button>
    </div>`;
}

function goPage(n) {
  const totalPages = Math.ceil(_files.length / PAGE_SIZE);
  if (n < 1 || n > totalPages) return;
  _page = n;
  renderTable();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Selection ─────────────────────────────────────────────────────────────────

function toggleSelect(id) {
  if (_selectedIds.has(id)) _selectedIds.delete(id);
  else _selectedIds.add(id);
  renderTable();
}

function clearSelection() {
  _selectedIds.clear();
  renderTable();
}

document.getElementById("select-all").addEventListener("change", (e) => {
  const sorted = fileSorter.sort(_files, fileValue);
  const start = (_page - 1) * PAGE_SIZE;
  const pageFiles = sorted.slice(start, start + PAGE_SIZE);
  if (e.target.checked) pageFiles.forEach((f) => _selectedIds.add(f.id));
  else pageFiles.forEach((f) => _selectedIds.delete(f.id));
  renderTable();
});

function renderBulkBar() {
  const bar = document.getElementById("bulk-bar");
  const n = _selectedIds.size;
  bar.style.display = n > 0 ? "flex" : "none";
  document.getElementById("bulk-count").textContent =
    `${n} file${n !== 1 ? "s" : ""} selected`;
}

// ── Bulk actions ──────────────────────────────────────────────────────────────

async function bulkDownload() {
  const ids = [..._selectedIds];
  if (!ids.length) return;
  const encFiles = ids.map((id) => window.FILE_CACHE[id]).filter((f) => f && f.iv_b64);
  let passphrase = null;
  if (encFiles.length > 0) {
    passphrase = prompt(`${encFiles.length} file(s) are encrypted. Enter passphrase:`);
    if (passphrase === null) return;
  }
  for (const id of ids) {
    await downloadFile(id, passphrase);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function bulkDelete() {
  const n = _selectedIds.size;
  if (!n) return;
  if (!confirm(`Permanently delete ${n} file${n !== 1 ? "s" : ""} from all providers?`)) return;
  const ids = [..._selectedIds];
  await Promise.all(ids.map((id) => fetch(`${API}/files/${id}`, { method: "DELETE" })));
  _selectedIds.clear();
  await loadData();
}

async function deleteSingle(id) {
  if (!confirm("Delete this file permanently from all providers?")) return;
  const res = await fetch(`${API}/files/${id}`, { method: "DELETE" });
  if (res.ok) {
    _selectedIds.delete(id);
    await loadData();
  } else {
    alert("Delete failed");
  }
}

// ── Session passphrase ────────────────────────────────────────────────────────

function setSessionPassphrase(p) {
  _sessionPassphrase = p || null;
  document.getElementById("session-banner").style.display = _sessionPassphrase ? "flex" : "none";
}

function clearSessionPassphrase() {
  setSessionPassphrase(null);
}

// ── Download ──────────────────────────────────────────────────────────────────

async function downloadFile(id, sharedPassphrase = undefined) {
  const f = window.FILE_CACHE[id];
  if (!f) return;

  let passphrase = sharedPassphrase;

  if (f.iv_b64 && passphrase === undefined) {
    // Use session passphrase silently if set
    if (_sessionPassphrase) {
      passphrase = _sessionPassphrase;
    } else {
      // Build prompt with hint if available
      let msg = `Enter passphrase to decrypt:\n"${f.name}"`;
      if (f.hint) msg += `\n\n💡 Hint: ${f.hint}`;
      passphrase = prompt(msg);
      if (passphrase === null) return;
    }
  }

  const res = await fetch(`${API}/files/${id}/download`);
  if (!res.ok) { alert(`Download failed: ${f.name}`); return; }

  let blob;
  if (f.iv_b64 && passphrase) {
    try {
      blob = new Blob([await window.FreeCrypto.decryptFile(await res.arrayBuffer(), f.iv_b64, passphrase)]);
    } catch {
      // Session passphrase failed — fall back to manual prompt with hint
      if (passphrase === _sessionPassphrase) {
        let msg = `Session passphrase didn't work for:\n"${f.name}"\n\nEnter passphrase manually:`;
        if (f.hint) msg += `\n\n💡 Hint: ${f.hint}`;
        passphrase = prompt(msg);
        if (!passphrase) return;
        try {
          blob = new Blob([await window.FreeCrypto.decryptFile(await res.arrayBuffer(), f.iv_b64, passphrase)]);
        } catch {
          alert(`Decryption failed for "${f.name}". Wrong passphrase?`);
          return;
        }
      } else {
        alert(`Decryption failed for "${f.name}". Wrong passphrase?`);
        return;
      }
    }
  } else {
    blob = await res.blob();
  }

  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: f.name });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Upload queue UI ───────────────────────────────────────────────────────────

function initQueue(files) {
  _uploadFiles = files;
  _uploadStates = files.map(() => ({
    state: "queued",
    pct: 0,
    error: null,
    startTime: 0,
    bytesLoaded: 0,
    totalBytes: 0,
  }));
  document.getElementById("upload-queue").style.display = "block";
  updateQueueUI();
}

function formatETA(secs) {
  if (!isFinite(secs) || secs <= 0) return "";
  if (secs < 60)   return `${Math.round(secs)}s left`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s left`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m left`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  return formatBytes(bytesPerSec) + "/s";
}

function uploadLabel(s) {
  if (s.state === "queued")      return "Queued";
  if (s.state === "encrypting")  return "Encrypting…";
  if (s.state === "processing") {
    if (s.totalBytes > 0 && s.pct > 0) {
      // Real Telegram progress from the polling endpoint
      const pct = Math.round(s.pct);
      const elapsed = s.startTime ? (Date.now() - s.startTime) / 1000 : 0;
      const speed   = elapsed > 0 ? s.bytesLoaded / elapsed : 0;
      const eta     = speed > 0 ? (s.totalBytes - s.bytesLoaded) / speed : 0;
      const parts   = [`${pct}%`, formatSpeed(speed), formatETA(eta)].filter(Boolean);
      return "☁ " + parts.join(" · ");
    }
    return "☁ Uploading to cloud…";
  }
  if (s.state === "done")        return "Done";
  if (s.state === "cancelled")   return "Cancelled";
  if (s.state === "failed")      return s.error || "Failed";

  // uploading — show pct + speed + ETA
  const pct = Math.round(s.pct);
  if (s.startTime && s.bytesLoaded > 0 && s.totalBytes > 0) {
    const elapsed = (Date.now() - s.startTime) / 1000;
    const speed   = s.bytesLoaded / elapsed;
    const eta     = (s.totalBytes - s.bytesLoaded) / speed;
    const parts   = [`${pct}%`, formatSpeed(speed), formatETA(eta)].filter(Boolean);
    return parts.join(" · ");
  }
  return `${pct}%`;
}

function updateQueueUI() {
  const done      = _uploadStates.filter((s) => s.state === "done").length;
  const failed    = _uploadStates.filter((s) => s.state === "failed").length;
  const cancelled = _uploadStates.filter((s) => s.state === "cancelled").length;
  const active    = _uploadStates.filter((s) => ["uploading", "encrypting", "processing"].includes(s.state)).length;
  const total     = _uploadStates.length;
  const allDone   = done + failed + cancelled === total;

  const summaryParts = [`${done} uploaded`];
  if (failed)    summaryParts.push(`${failed} failed`);
  if (cancelled) summaryParts.push(`${cancelled} cancelled`);
  document.getElementById("uq-summary").textContent = allDone
    ? summaryParts.join(", ")
    : `Uploading ${total} file${total !== 1 ? "s" : ""} — ${done} done`;
  document.getElementById("uq-concurrency").textContent = allDone ? "" : `${active} active`;

  const ICONS = { queued: "⏸", encrypting: "🔐", uploading: "⬆", processing: "⏳", done: "✓", failed: "✗", cancelled: "✕" };
  const CANCELABLE = new Set(["uploading", "processing"]);

  document.getElementById("uq-list").innerHTML = _uploadFiles.map((f, i) => {
    const s = _uploadStates[i];
    const name   = f.name.length > 36 ? f.name.slice(0, 33) + "…" : f.name;
    const barPct = (s.state === "done" || s.state === "processing") ? 100
                 : s.state === "uploading" ? s.pct
                 : 0;
    const cancelBtn = CANCELABLE.has(s.state)
      ? `<span class="uq-cancel" onclick="cancelUpload(${i})" title="Cancel">✕</span>`
      : `<span class="uq-cancel uq-cancel-hidden"></span>`;

    return `
    <div class="uq-row uq-state-${s.state}">
      <span class="uq-icon">${ICONS[s.state] ?? "⏸"}</span>
      <span class="uq-name" title="${escHtml(f.name)}">${escHtml(name)}</span>
      <div class="uq-bar-wrap">
        <div class="uq-bar" style="width:${barPct}%"></div>
      </div>
      <span class="uq-label">${escHtml(uploadLabel(s))}</span>
      ${cancelBtn}
    </div>`;
  }).join("");
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i](i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ── Cloud progress polling ────────────────────────────────────────────────────

const _pollers = {};

function startCloudProgressPolling(idx, uploadId) {
  async function poll() {
    try {
      const res = await fetch(`${API}/files/upload-progress/${uploadId}`);
      if (!res.ok) return; // 404 = already done, stop polling
      const { sent, total } = await res.json();
      if (total > 0 && _uploadStates[idx]?.state === "processing") {
        _uploadStates[idx].bytesLoaded = sent;
        _uploadStates[idx].totalBytes  = total;
        _uploadStates[idx].pct         = (sent / total) * 100;
        updateQueueUI();
      }
    } catch (_) { /* ignore transient errors */ }
    if (_uploadStates[idx]?.state === "processing") {
      _pollers[idx] = setTimeout(poll, 600);
    }
  }
  poll();
}

function stopCloudProgressPolling(idx) {
  clearTimeout(_pollers[idx]);
  delete _pollers[idx];
}

// ── Single file upload task ───────────────────────────────────────────────────

function uploadXHR(formData, onProgress, onSent, onXHRReady) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (onXHRReady) onXHRReady(xhr);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    });
    // Fires when the browser finishes sending — server is now processing/uploading to cloud
    xhr.upload.addEventListener("load", () => onSent && onSent());
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else {
        try { reject(new Error(JSON.parse(xhr.responseText).detail)); }
        catch { reject(new Error(xhr.statusText || "Upload failed")); }
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Cancelled")));
    xhr.open("POST", `${API}/files/upload`);
    xhr.send(formData);
  });
}

async function uploadFileTask(idx, passphrase, hint, provider) {
  const file = _uploadFiles[idx];
  const uploadId = crypto.randomUUID ? crypto.randomUUID()
                 : Math.random().toString(36).slice(2) + Date.now().toString(36);
  _uploadIds[idx] = uploadId;

  try {
    let uploadData, ivB64 = null;

    if (passphrase) {
      // Encrypt: must load into memory for Web Crypto API
      _uploadStates[idx].state = "encrypting";
      updateQueueUI();
      const buffer = await file.arrayBuffer();
      const { ciphertext, ivB64: iv } = await window.FreeCrypto.encryptFile(buffer, passphrase);
      uploadData = new Blob([ciphertext]);
      ivB64 = iv;
    } else {
      // No passphrase: send File object directly — browser streams it from disk,
      // no memory allocation needed regardless of file size
      uploadData = file;
    }

    // Upload phase
    _uploadStates[idx].state = "uploading";
    _uploadStates[idx].pct = 0;
    _uploadStates[idx].startTime = Date.now();
    _uploadStates[idx].bytesLoaded = 0;
    _uploadStates[idx].totalBytes = uploadData.size || 0;
    updateQueueUI();

    const form = new FormData();
    form.append("file", uploadData, file.name);
    form.append("mime_type", file.type || "application/octet-stream");
    form.append("upload_id", uploadId);
    if (ivB64) form.append("iv_b64", ivB64);
    if (ivB64 && hint) form.append("hint", hint);
    if (provider) form.append("provider", provider);

    await uploadXHR(
      form,
      (loaded, total) => {
        _uploadStates[idx].bytesLoaded = loaded;
        _uploadStates[idx].totalBytes  = total;
        _uploadStates[idx].pct = (loaded / total) * 100;
        updateQueueUI();
      },
      () => {
        // Browser→server done; server is now uploading each chunk to the cloud provider
        _uploadStates[idx].state = "processing";
        _uploadStates[idx].pct   = 0;
        _uploadStates[idx].startTime = Date.now();
        updateQueueUI();
        startCloudProgressPolling(idx, uploadId);
      },
      (xhr) => { _activeXHRs[idx] = xhr; }
    );

    stopCloudProgressPolling(idx);
    delete _activeXHRs[idx];
    delete _uploadIds[idx];
    _uploadStates[idx].state = "done";
    _uploadStates[idx].pct   = 100;
    updateQueueUI();
    return { ok: true };

  } catch (err) {
    stopCloudProgressPolling(idx);
    delete _activeXHRs[idx];
    delete _uploadIds[idx];
    const wasCancelled = err.message === "Cancelled";
    _uploadStates[idx].state = wasCancelled ? "cancelled" : "failed";
    if (!wasCancelled) _uploadStates[idx].error = err.message;
    updateQueueUI();
    return { ok: false, error: err.message };
  }
}

async function cancelUpload(idx) {
  const s = _uploadStates[idx];
  if (!s) return;
  if (s.state === "uploading") {
    // Abort the browser→server XHR (triggers abort event → "Cancelled" rejection)
    const xhr = _activeXHRs[idx];
    if (xhr) xhr.abort();
  } else if (s.state === "processing") {
    // Cancel the server-side Telegram upload task
    const uploadId = _uploadIds[idx];
    if (uploadId) {
      try { await fetch(`${API}/files/upload-progress/${uploadId}`, { method: "DELETE" }); }
      catch (_) {}
    }
    // Server returns 499 → XHR load fires → non-2xx → reject("Upload cancelled")
    // The catch block above will set state = "cancelled"
  }
}

// ── Handle upload form ────────────────────────────────────────────────────────

async function handleUpload(e) {
  e.preventDefault();
  const fileInput  = document.getElementById("file-input");
  const passphrase = document.getElementById("passphrase").value;
  const hint       = document.getElementById("hint").value.trim();
  const remember   = document.getElementById("remember-session").checked;
  const provider   = document.getElementById("provider-select").value;
  const btn        = document.getElementById("upload-btn");
  const files      = [...fileInput.files];
  if (!files.length) return;

  btn.disabled = true;
  initQueue(files);

  const tasks = files.map((_, i) => () => uploadFileTask(i, passphrase, hint, provider));
  // hint is only sent for encrypted files (checked inside uploadFileTask)
  const results = await runPool(tasks, UPLOAD_CONCURRENCY);

  // Save session passphrase if requested and upload succeeded
  if (passphrase && remember && results.some((r) => r.ok)) {
    setSessionPassphrase(passphrase);
  }

  btn.disabled = false;
  fileInput.value = "";
  document.getElementById("passphrase").value = "";
  document.getElementById("hint").value = "";
  document.getElementById("remember-session").checked = false;
  document.getElementById("passphrase-extras").style.display = "none";
  _selectedIds.clear();
  loadData();

  const anyFailed = results.some((r) => !r.ok);
  if (!anyFailed) {
    setTimeout(() => {
      document.getElementById("upload-queue").style.display = "none";
    }, 4000);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.FILE_CACHE = {};
initTheme();
fileSorter.attachHeaders(document, () => { _page = 1; renderTable(); });
document.getElementById("upload-form").addEventListener("submit", handleUpload);

// Show hint + remember fields only when passphrase is typed
document.getElementById("passphrase").addEventListener("input", (e) => {
  document.getElementById("passphrase-extras").style.display =
    e.target.value ? "flex" : "none";
  if (!e.target.value) {
    document.getElementById("hint").value = "";
    document.getElementById("remember-session").checked = false;
  }
});

loadData();
