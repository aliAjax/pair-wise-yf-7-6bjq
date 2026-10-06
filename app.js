const storageKey = "zfl16-movable-type-workshop";
const resumeKey = "zfl16-movable-type-workshop-resume";
const STORAGE_VERSION = 1;

const starterInventory = [
  { id: crypto.randomUUID(), char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
  { id: crypto.randomUUID(), char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "风", style: "楷体木刻", size: 28, quantity: 2, wear: "微磨" },
  { id: crypto.randomUUID(), char: "花", style: "楷体木刻", size: 28, quantity: 2, wear: "新" },
  { id: crypto.randomUUID(), char: "茶", style: "黑体铅字", size: 24, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "雨", style: "仿宋细字", size: 22, quantity: 4, wear: "新" }
];

const defaultState = {
  version: STORAGE_VERSION,
  inventory: starterInventory,
  selectedTypeId: starterInventory[0].id,
  placements: [],
  drafts: [],
  settings: {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  }
};

const els = {
  paperSize: document.querySelector("#paperSize"),
  flowMode: document.querySelector("#flowMode"),
  gridGap: document.querySelector("#gridGap"),
  workTitle: document.querySelector("#workTitle"),
  stage: document.querySelector("#stage"),
  typeList: document.querySelector("#typeList"),
  typeForm: document.querySelector("#typeForm"),
  charInput: document.querySelector("#charInput"),
  styleInput: document.querySelector("#styleInput"),
  sizeInput: document.querySelector("#sizeInput"),
  quantityInput: document.querySelector("#quantityInput"),
  wearInput: document.querySelector("#wearInput"),
  inventorySearch: document.querySelector("#inventorySearch"),
  styleFilter: document.querySelector("#styleFilter"),
  selectedTypeLabel: document.querySelector("#selectedTypeLabel"),
  shortageBadge: document.querySelector("#shortageBadge"),
  usageList: document.querySelector("#usageList"),
  draftList: document.querySelector("#draftList"),
  placedCount: document.querySelector("#placedCount"),
  inventoryCount: document.querySelector("#inventoryCount"),
  saveDraftBtn: document.querySelector("#saveDraftBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  clearBoardBtn: document.querySelector("#clearBoardBtn"),
  notice: document.querySelector("#notice"),
  resumeBanner: document.querySelector("#resumeBanner"),
  resumeMessage: document.querySelector("#resumeMessage"),
  resumeAcceptBtn: document.querySelector("#resumeAcceptBtn"),
  resumeDiscardBtn: document.querySelector("#resumeDiscardBtn")
};

let state = loadState();
let pendingResume = null;

/* ---------------- 本地存储：写入、降级、回滚 ---------------- */

function isQuotaError(err) {
  if (!err) return false;
  return err.name === "QuotaExceededError"
    || err.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || err.code === 22
    || err.code === 1014;
}

// 记录每个键上一份成功写入的值，保存失败时用来恢复
const lastKnownGood = new Map();

function freeRedundantCopies() {
  // 容量到顶时降级：清掉多余的备份副本，只留最新一份
  let removed = false;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(storageKey) && key.endsWith("-backup")) {
        localStorage.removeItem(key);
        removed = true;
      }
    }
  } catch { /* 清理失败可忽略 */ }
  return removed;
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* 忽略 */ }
}

function storageSet(key, value, options = {}) {
  const previous = storageGet(key);
  // 先把上一份挪到备份键，再写新值
  if (options.backupKey && previous != null) {
    try { localStorage.setItem(options.backupKey, previous); } catch { /* 备份失败不影响主流程 */ }
  }
  try {
    localStorage.setItem(key, value);
    lastKnownGood.set(key, value);
    return { ok: true };
  } catch (err) {
    if (!isQuotaError(err)) return { ok: false, error: err };
    // 浏览器存储容量到顶：先降级到只留最新一份
    freeRedundantCopies();
    try {
      localStorage.setItem(key, value);
      lastKnownGood.set(key, value);
      return { ok: true, degraded: true };
    } catch (err2) {
      // 保存失败：恢复上一份存档
      const rollback = lastKnownGood.get(key) ?? previous;
      if (rollback != null) {
        try { localStorage.setItem(key, rollback); } catch { /* 无法恢复 */ }
      }
      return { ok: false, degraded: true, error: err2 };
    }
  }
}

/* ---------------- 数据迁移：补齐新字段，失败保留原存档 ---------------- */

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeInventoryItem(item) {
  return {
    id: typeof item?.id === "string" && item.id ? item.id : crypto.randomUUID(),
    char: typeof item?.char === "string" ? item.char : "",
    style: typeof item?.style === "string" ? item.style : "",
    size: num(item?.size, 24),
    quantity: num(item?.quantity, 1),
    wear: typeof item?.wear === "string" ? item.wear : "新"
  };
}

function normalizePlacement(p) {
  if (!p || typeof p !== "object") return null;
  const row = num(p.row, NaN);
  const col = num(p.col, NaN);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row, col, typeId: typeof p.typeId === "string" ? p.typeId : "" };
}

function migrateState(parsed) {
  if (!parsed || typeof parsed !== "object") return structuredClone(defaultState);
  const rawSettings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};

  const inventory = Array.isArray(parsed.inventory)
    ? parsed.inventory.filter((it) => it && typeof it === "object").map(normalizeInventoryItem)
    : structuredClone(defaultState.inventory);

  const placements = Array.isArray(parsed.placements)
    ? parsed.placements.map(normalizePlacement).filter(Boolean)
    : [];

  const drafts = Array.isArray(parsed.drafts)
    ? parsed.drafts.filter((d) => d && typeof d === "object").map((d) => ({
        id: typeof d.id === "string" && d.id ? d.id : crypto.randomUUID(),
        title: typeof d.title === "string" ? d.title : "未命名作品",
        settings: {
          ...defaultState.settings,
          ...(d.settings && typeof d.settings === "object" ? d.settings : {})
        },
        placements: Array.isArray(d.placements) ? d.placements.map(normalizePlacement).filter(Boolean) : [],
        savedAt: typeof d.savedAt === "string" ? d.savedAt : new Date(0).toISOString()
      }))
    : [];

  return {
    version: STORAGE_VERSION,
    inventory,
    selectedTypeId: typeof parsed.selectedTypeId === "string" ? parsed.selectedTypeId : (inventory[0]?.id ?? null),
    placements,
    drafts,
    settings: {
      paperSize: ["postcard", "bookmark", "square"].includes(rawSettings.paperSize) ? rawSettings.paperSize : defaultState.settings.paperSize,
      flowMode: rawSettings.flowMode === "vertical" ? "vertical" : defaultState.settings.flowMode,
      gridGap: Math.min(18, Math.max(4, num(rawSettings.gridGap, defaultState.settings.gridGap))),
      workTitle: typeof rawSettings.workTitle === "string" ? rawSettings.workTitle : defaultState.settings.workTitle
    }
  };
}

function loadState() {
  const raw = storageGet(storageKey);
  if (raw == null) return structuredClone(defaultState);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    notify("存档解析失败，已保留原存档。", "warn");
    return structuredClone(defaultState);
  }
  try {
    return migrateState(parsed);
  } catch (err) {
    notify("存档迁移失败，已保留原存档：" + (err?.message ?? err), "warn");
    return structuredClone(defaultState);
  }
}

function saveState() {
  const result = storageSet(storageKey, JSON.stringify(state));
  if (!result.ok) notify("本地存档保存失败，已恢复上一份存档。", "warn");
  else if (result.degraded) notify("浏览器存储空间不足，已降级为只保留最新存档。", "warn");
}

/* ---------------- 自动续排存档 ---------------- */

function buildResumeSnapshot() {
  return {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    state: {
      inventory: structuredClone(state.inventory),
      selectedTypeId: state.selectedTypeId,
      placements: structuredClone(state.placements),
      settings: structuredClone(state.settings)
    }
  };
}

function saveResume() {
  const result = storageSet(resumeKey, JSON.stringify(buildResumeSnapshot()), { backupKey: `${resumeKey}-backup` });
  if (!result.ok) notify("自动续排保存失败，已恢复上一份存档。", "warn");
  else if (result.degraded) notify("浏览器存储空间不足，已降级为只保留最新续排存档。", "warn");
}

function loadResume() {
  const raw = storageGet(resumeKey);
  if (raw == null) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  try {
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    return {
      version: parsed.version ?? 1,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
      state: migrateState(parsed.state)
    };
  } catch (err) {
    notify("续排存档迁移失败，已保留原存档：" + (err?.message ?? err), "warn");
    return null;
  }
}

function persist() {
  saveState();
  saveResume();
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "时间未知";
  return d.toLocaleString("zh-CN");
}

function checkResumeOnLoad() {
  const resume = loadResume();
  if (!resume || !resume.savedAt) return;
  const latestDraft = state.drafts[0];
  const resumeTime = new Date(resume.savedAt).getTime();
  const draftTime = latestDraft ? new Date(latestDraft.savedAt).getTime() : 0;
  if (resumeTime <= draftTime) return;
  const placementCount = resume.state.placements.length;
  const typeCount = resume.state.inventory.length;
  const draftText = latestDraft ? `最近一次草稿（${formatTime(latestDraft.savedAt)}）` : "最近一次草稿（无）";
  els.resumeMessage.textContent = `检测到自动续排存档（${formatTime(resume.savedAt)}），比${draftText}新，含 ${placementCount} 个落字、${typeCount} 枚字模。是否继续上次排版？`;
  els.resumeBanner.hidden = false;
  pendingResume = resume;
}

function applyResume() {
  if (!pendingResume) return;
  state.inventory = pendingResume.state.inventory;
  state.selectedTypeId = pendingResume.state.selectedTypeId;
  state.placements = pendingResume.state.placements;
  state.settings = pendingResume.state.settings;
  els.resumeBanner.hidden = true;
  pendingResume = null;
  persist();
  renderAll();
  notify("已恢复自动续排存档。", "ok");
}

function discardResume() {
  storageRemove(resumeKey);
  storageRemove(`${resumeKey}-backup`);
  els.resumeBanner.hidden = true;
  pendingResume = null;
  notify("已放弃续排存档，已保存草稿不受影响。", "ok");
}

/* ---------------- 通知条 ---------------- */

let noticeTimer = null;
function notify(message, type = "info") {
  if (typeof els === "undefined" || !els.notice) return;
  els.notice.textContent = message;
  els.notice.className = `notice ${type}`;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { els.notice.hidden = true; }, 6000);
}

/* ---------------- 核对：按当前库存重算缺字、超量 ---------------- */

function getGrid() {
  const size = state.settings.paperSize;
  if (size === "bookmark") return { cols: 7, rows: 18 };
  if (size === "square") return { cols: 12, rows: 12 };
  return { cols: 16, rows: 10 };
}

function placementKey(row, col) {
  return `${row}:${col}`;
}

function getSelectedType() {
  return state.inventory.find((item) => item.id === state.selectedTypeId) || null;
}

function getUsage() {
  return state.placements.reduce((acc, placement) => {
    acc[placement.typeId] = (acc[placement.typeId] || 0) + 1;
    return acc;
  }, {});
}

function analyzePlacements() {
  // 一律按当前库存与当前落字重算，不使用任何旧计数
  const usage = getUsage();
  const order = new Map();
  state.placements.forEach((p) => {
    if (!order.has(p.typeId)) order.set(p.typeId, []);
    order.get(p.typeId).push(p);
  });
  const missing = [];
  const excess = [];
  state.placements.forEach((p) => {
    const type = state.inventory.find((t) => t.id === p.typeId);
    if (!type) {
      // 字模已缺失：这一格是缺字
      missing.push(p);
      return;
    }
    const used = usage[p.typeId] || 0;
    if (used > type.quantity) {
      const sorted = [...(order.get(p.typeId) || [])].sort((a, b) => a.row - b.row || a.col - b.col);
      if (sorted.indexOf(p) >= type.quantity) excess.push(p);
    }
  });
  return { usage, missing, excess };
}

/* ---------------- 渲染 ---------------- */

function renderSettings() {
  els.paperSize.value = state.settings.paperSize;
  els.flowMode.value = state.settings.flowMode;
  els.gridGap.value = state.settings.gridGap;
  els.workTitle.value = state.settings.workTitle;
}

function renderStyleFilter() {
  const current = els.styleFilter.value || "all";
  const styles = [...new Set(state.inventory.map((item) => item.style))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  els.styleFilter.innerHTML = `<option value="all">全部风格</option>${styles
    .map((style) => `<option value="${escapeHtml(style)}">${escapeHtml(style)}</option>`)
    .join("")}`;
  els.styleFilter.value = styles.includes(current) ? current : "all";
}

function renderInventory() {
  const keyword = els.inventorySearch.value.trim();
  const style = els.styleFilter.value;
  const usage = getUsage();
  const items = state.inventory.filter((item) => {
    const matchesKeyword = !keyword || `${item.char}${item.style}${item.wear}`.includes(keyword);
    const matchesStyle = style === "all" || item.style === style;
    return matchesKeyword && matchesStyle;
  });

  els.inventoryCount.textContent = `${state.inventory.length}枚字模`;
  els.typeList.innerHTML = items
    .map((item) => {
      const used = usage[item.id] || 0;
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      return `
        <article class="type-card ${selected}" draggable="true" data-type-id="${item.id}">
          <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
          <div class="type-meta">
            <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
            <span>${item.size}px · ${escapeHtml(item.wear)} · 已用${used}/${item.quantity}</span>
          </div>
          <button class="mini-btn" title="删除字模" data-delete-type="${item.id}" type="button">×</button>
        </article>
      `;
    })
    .join("");
}

function renderStage() {
  const { cols, rows } = getGrid();
  const map = new Map(state.placements.map((item) => [placementKey(item.row, item.col), item]));
  const { missing, excess } = analyzePlacements();
  const missingKeys = new Set(missing.map((p) => placementKey(p.row, p.col)));
  const excessKeys = new Set(excess.map((p) => placementKey(p.row, p.col)));
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const placement = map.get(placementKey(row, col));
      const type = placement ? state.inventory.find((item) => item.id === placement.typeId) : null;
      const isMissing = placement ? missingKeys.has(placementKey(row, col)) : false;
      const isExcess = placement ? excessKeys.has(placementKey(row, col)) : false;
      const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
      let content = "";
      if (isMissing) {
        content = '<span class="cell-mark" title="字模已缺失">缺</span>';
      } else if (type) {
        content = escapeHtml(type.char) + (isExcess ? '<span class="cell-tag" title="超出库存数量">超</span>' : "");
      }
      cells.push(`
        <button class="cell ${type ? "used" : ""} ${vertical} ${isMissing ? "missing" : ""} ${isExcess ? "excess" : ""}" data-row="${row}" data-col="${col}" type="button" aria-label="第${row + 1}行第${col + 1}列">
          ${content}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function renderUsage() {
  const { usage, missing } = analyzePlacements();
  const entries = state.inventory.filter((item) => usage[item.id]);
  els.placedCount.textContent = `${state.placements.length}个落字`;

  const excessCount = entries.reduce((n, item) => n + Math.max(0, (usage[item.id] || 0) - item.quantity), 0);
  const warnCount = missing.length + excessCount;
  els.shortageBadge.textContent = warnCount ? `缺字${missing.length} · 超量${excessCount}` : "数量充足";
  els.shortageBadge.className = `badge ${warnCount ? "warn" : "ok"}`;

  const selectedType = getSelectedType();
  els.selectedTypeLabel.textContent = selectedType ? `当前：${selectedType.char} · ${selectedType.style}` : "未选择字模";

  const usageHtml = entries
    .map((item) => {
      const used = usage[item.id];
      const warn = used > item.quantity ? "warn" : "";
      return `
        <div class="usage-item ${warn}">
          <strong>${escapeHtml(item.char)} ${escapeHtml(item.style)}</strong>
          <span>${used}/${item.quantity}</span>
        </div>
      `;
    })
    .join("");
  const missingHtml = missing.length
    ? `<div class="usage-item warn"><strong>缺字</strong><span>${missing.length}处字模已缺失</span></div>`
    : "";
  els.usageList.innerHTML = usageHtml + missingHtml || `<p class="empty">还没有落字。</p>`;
}

function renderDrafts() {
  els.draftList.innerHTML =
    state.drafts
      .map(
        (draft) => `
          <article class="draft-item">
            <strong>${escapeHtml(draft.title)}</strong>
            <span>${draft.placements.length}个落字 · ${new Date(draft.savedAt).toLocaleString("zh-CN")}</span>
            <div class="draft-actions">
              <button type="button" data-load-draft="${draft.id}">载入</button>
              <button type="button" data-delete-draft="${draft.id}">删除</button>
            </div>
          </article>
        `
      )
      .join("") || `<p class="empty">还没有保存草稿。</p>`;
}

function renderAll() {
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage();
  renderUsage();
  renderDrafts();
}

/* ---------------- 操作 ---------------- */

function placeType(row, col, typeId = state.selectedTypeId) {
  if (!typeId) return;
  const existingIndex = state.placements.findIndex((item) => item.row === row && item.col === col);
  if (existingIndex >= 0) {
    if (state.placements[existingIndex].typeId === typeId) {
      state.placements.splice(existingIndex, 1);
    } else {
      state.placements[existingIndex].typeId = typeId;
    }
  } else {
    state.placements.push({ row, col, typeId });
  }
  persist();
  renderAll();
}

function addType(event) {
  event.preventDefault();
  const item = {
    id: crypto.randomUUID(),
    char: els.charInput.value.trim(),
    style: els.styleInput.value.trim(),
    size: Number(els.sizeInput.value),
    quantity: Number(els.quantityInput.value),
    wear: els.wearInput.value
  };
  if (!item.char || !item.style) return;
  state.inventory.unshift(item);
  state.selectedTypeId = item.id;
  els.typeForm.reset();
  els.sizeInput.value = 24;
  els.quantityInput.value = 3;
  persist();
  renderAll();
}

function saveDraft() {
  const title = state.settings.workTitle.trim() || "未命名作品";
  state.drafts.unshift({
    id: crypto.randomUUID(),
    title,
    settings: structuredClone(state.settings),
    placements: structuredClone(state.placements),
    savedAt: new Date().toISOString()
  });
  state.drafts = state.drafts.slice(0, 8);
  persist();
  renderAll();
  notify("草稿已保存。", "ok");
}

function exportPreview() {
  const { cols, rows } = getGrid();
  const cell = state.settings.paperSize === "bookmark" ? 44 : 56;
  const gap = state.settings.gridGap;
  const margin = 48;
  const width = cols * cell + (cols - 1) * gap + margin * 2;
  const height = rows * cell + (rows - 1) * gap + margin * 2 + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffaf1";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#2f2921";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.fillStyle = "#22201c";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(state.settings.workTitle || "未命名作品", margin, 50);
  ctx.font = "bold 30px serif";
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
    if (!type) return;
    const x = margin + placement.col * (cell + gap);
    const y = margin + 45 + placement.row * (cell + gap);
    ctx.fillStyle = "#2f2921";
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = "#fff5df";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.min(type.size + 8, 42)}px serif`;
    ctx.fillText(type.char, x + cell / 2, y + cell / 2);
  });
  const link = document.createElement("a");
  link.download = `${state.settings.workTitle || "movable-type"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------------- 事件 ---------------- */

els.paperSize.addEventListener("change", () => {
  state.settings.paperSize = els.paperSize.value;
  const { cols, rows } = getGrid();
  state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
  persist();
  renderAll();
});

els.flowMode.addEventListener("change", () => {
  state.settings.flowMode = els.flowMode.value;
  persist();
  renderAll();
});

els.gridGap.addEventListener("input", () => {
  state.settings.gridGap = Number(els.gridGap.value);
  persist();
  renderAll();
});

els.workTitle.addEventListener("input", () => {
  state.settings.workTitle = els.workTitle.value;
  persist();
});

els.typeForm.addEventListener("submit", addType);
els.inventorySearch.addEventListener("input", renderInventory);
els.styleFilter.addEventListener("change", renderInventory);
els.saveDraftBtn.addEventListener("click", saveDraft);
els.exportBtn.addEventListener("click", exportPreview);
els.clearBoardBtn.addEventListener("click", () => {
  state.placements = [];
  persist();
  renderAll();
});

els.typeList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    const typeId = deleteButton.dataset.deleteType;
    state.inventory = state.inventory.filter((item) => item.id !== typeId);
    state.placements = state.placements.filter((item) => item.typeId !== typeId);
    if (state.selectedTypeId === typeId) state.selectedTypeId = state.inventory[0]?.id || null;
    persist();
    renderAll();
    return;
  }
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  state.selectedTypeId = card.dataset.typeId;
  persist();
  renderAll();
});

els.typeList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.typeId);
});

els.stage.addEventListener("dragover", (event) => {
  if (event.target.closest(".cell")) event.preventDefault();
});

els.stage.addEventListener("drop", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  event.preventDefault();
  placeType(Number(cell.dataset.row), Number(cell.dataset.col), event.dataTransfer.getData("text/plain"));
});

els.stage.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  placeType(Number(cell.dataset.row), Number(cell.dataset.col));
});

els.draftList.addEventListener("click", (event) => {
  const loadButton = event.target.closest("[data-load-draft]");
  const deleteButton = event.target.closest("[data-delete-draft]");
  if (loadButton) {
    const draft = state.drafts.find((item) => item.id === loadButton.dataset.loadDraft);
    if (!draft) return;
    state.settings = structuredClone(draft.settings);
    state.placements = structuredClone(draft.placements);
    persist();
    renderAll();
  }
  if (deleteButton) {
    state.drafts = state.drafts.filter((item) => item.id !== deleteButton.dataset.deleteDraft);
    persist();
    renderAll();
  }
});

els.resumeAcceptBtn.addEventListener("click", applyResume);
els.resumeDiscardBtn.addEventListener("click", discardResume);

renderAll();
checkResumeOnLoad();
