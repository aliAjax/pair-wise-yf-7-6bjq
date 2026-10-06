const storageKey = "zfl16-movable-type-workshop";
const autosaveKey = "zfl16-movable-type-workshop-autosave";
const STATE_VERSION = 2;

const starterInventory = [
  { id: crypto.randomUUID(), char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
  { id: crypto.randomUUID(), char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "风", style: "楷体木刻", size: 28, quantity: 2, wear: "微磨" },
  { id: crypto.randomUUID(), char: "花", style: "楷体木刻", size: 28, quantity: 2, wear: "新" },
  { id: crypto.randomUUID(), char: "茶", style: "黑体铅字", size: 24, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "雨", style: "仿宋细字", size: 22, quantity: 4, wear: "新" }
];

const defaultState = {
  version: STATE_VERSION,
  inventory: starterInventory,
  selectedTypeId: starterInventory[0].id,
  placements: [],
  drafts: [],
  orphanChars: {},
  settings: {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  }
};

let migrationError = null;
let state = loadState();
let autosaveStore = loadAutosaveStore();
let pendingRestore = Boolean(autosaveStore.current);
const storageNotices = { main: "", autosave: "" };

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
  autosaveBanner: document.querySelector("#autosaveBanner"),
  autosaveMeta: document.querySelector("#autosaveMeta"),
  autosaveFresh: document.querySelector("#autosaveFresh"),
  restoreAutosaveBtn: document.querySelector("#restoreAutosaveBtn"),
  discardAutosaveBtn: document.querySelector("#discardAutosaveBtn"),
  storageNotice: document.querySelector("#storageNotice")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  try {
    return migrateState(JSON.parse(saved));
  } catch (err) {
    // 迁移失败：保留原始存档不覆盖，界面给出说明，本次改动不再写回
    migrationError = err;
    return structuredClone(defaultState);
  }
}

function migrateState(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("存档结构无法识别");
  }
  const base = structuredClone(defaultState);
  const migrated = {
    ...base,
    ...parsed,
    version: STATE_VERSION,
    settings: { ...base.settings, ...(parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {}) },
    orphanChars:
      parsed.orphanChars && typeof parsed.orphanChars === "object" && !Array.isArray(parsed.orphanChars)
        ? parsed.orphanChars
        : {}
  };
  if (!Array.isArray(migrated.inventory)) throw new Error("字模库数据损坏");
  if (!Array.isArray(migrated.placements)) migrated.placements = [];
  if (!Array.isArray(migrated.drafts)) migrated.drafts = [];
  migrated.inventory = migrated.inventory
    .filter((item) => item && typeof item === "object" && item.char)
    .map((item) => ({
      id: item.id || crypto.randomUUID(),
      char: String(item.char),
      style: item.style || "未分类",
      size: Number(item.size) || 24,
      quantity: Math.max(1, Number(item.quantity) || 1),
      wear: item.wear || "新"
    }));
  migrated.placements = migrated.placements.filter(
    (item) => item && Number.isInteger(item.row) && Number.isInteger(item.col) && item.typeId
  );
  migrated.drafts = migrated.drafts
    .filter((draft) => draft && typeof draft === "object")
    .map((draft) => ({
      id: draft.id || crypto.randomUUID(),
      title: draft.title || "未命名作品",
      settings: { ...base.settings, ...(draft.settings && typeof draft.settings === "object" ? draft.settings : {}) },
      placements: Array.isArray(draft.placements) ? draft.placements : [],
      savedAt: draft.savedAt || new Date().toISOString()
    }));
  if (!migrated.inventory.some((item) => item.id === migrated.selectedTypeId)) {
    migrated.selectedTypeId = migrated.inventory[0]?.id || null;
  }
  return migrated;
}

function saveState() {
  if (migrationError) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    storageNotices.main = "";
  } catch {
    storageNotices.main = "主存档写入失败，本次修改可能不会被保存。";
  }
  renderStorageNotice();
}

function snapshotState() {
  const usedTypeIds = new Set(state.placements.map((item) => item.typeId));
  const orphanChars = {};
  Object.entries(state.orphanChars).forEach(([typeId, char]) => {
    if (usedTypeIds.has(typeId)) orphanChars[typeId] = char;
  });
  return {
    savedAt: new Date().toISOString(),
    settings: structuredClone(state.settings),
    placements: structuredClone(state.placements),
    selectedTypeId: state.selectedTypeId,
    inventory: structuredClone(state.inventory),
    orphanChars
  };
}

function loadAutosaveStore() {
  let raw = null;
  try {
    raw = localStorage.getItem(autosaveKey);
  } catch {
    return { version: STATE_VERSION, current: null, prev: null, degraded: false };
  }
  if (!raw) return { version: STATE_VERSION, current: null, prev: null, degraded: false };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("续排存档结构无法识别");
    return {
      version: STATE_VERSION,
      current: parsed.current || null,
      prev: parsed.prev || null,
      degraded: Boolean(parsed.degraded)
    };
  } catch {
    return { version: STATE_VERSION, current: null, prev: null, degraded: false };
  }
}

function recordAutosave() {
  pendingRestore = false;
  if (migrationError) {
    renderAutosaveBanner();
    return;
  }
  const snapshot = snapshotState();
  const next = { version: STATE_VERSION, current: snapshot, prev: autosaveStore.current || null, degraded: false };
  try {
    localStorage.setItem(autosaveKey, JSON.stringify(next));
    autosaveStore = next;
    storageNotices.autosave = "";
  } catch {
    // 容量到顶：降级为只留最新一份
    const degraded = { version: STATE_VERSION, current: snapshot, prev: null, degraded: true };
    try {
      localStorage.setItem(autosaveKey, JSON.stringify(degraded));
      autosaveStore = degraded;
      storageNotices.autosave = "存储空间不足，续排存档已降级为只保留最新一份。";
    } catch {
      // 写入仍失败：localStorage 中的旧值未被破坏，上一份存档仍可恢复
      storageNotices.autosave = "续排存档写入失败，已保留上一份存档。";
    }
  }
  renderStorageNotice();
  renderAutosaveBanner();
}

function clearAutosave() {
  autosaveStore = { version: STATE_VERSION, current: null, prev: null, degraded: false };
  try {
    localStorage.removeItem(autosaveKey);
  } catch {
    // 清除失败不影响主流程
  }
}

function restoreAutosave() {
  const snapshot = autosaveStore.current;
  if (!snapshot) return;
  pendingRestore = false;
  state.settings = { ...structuredClone(defaultState.settings), ...(snapshot.settings || {}) };
  const { cols, rows } = getGrid();
  state.placements = Array.isArray(snapshot.placements)
    ? snapshot.placements.filter((item) => item.row < rows && item.col < cols)
    : [];
  // 字模数量一律按当前库存重算，快照里的旧库存只用于补显示缺字，不顶回当前数字
  const currentTypeIds = new Set(state.inventory.map((item) => item.id));
  const orphanChars = { ...(snapshot.orphanChars || {}) };
  (Array.isArray(snapshot.inventory) ? snapshot.inventory : []).forEach((item) => {
    if (item && !currentTypeIds.has(item.id)) orphanChars[item.id] = item.char;
  });
  const usedTypeIds = new Set(state.placements.map((item) => item.typeId));
  state.orphanChars = {};
  Object.entries(orphanChars).forEach(([typeId, char]) => {
    if (usedTypeIds.has(typeId)) state.orphanChars[typeId] = char;
  });
  state.selectedTypeId = currentTypeIds.has(snapshot.selectedTypeId)
    ? snapshot.selectedTypeId
    : state.inventory[0]?.id || null;
  clearAutosave();
  renderAll();
}

function discardAutosave() {
  pendingRestore = false;
  clearAutosave();
  renderAutosaveBanner();
}

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

function getCellFlags() {
  const counts = {};
  const overKeys = new Set();
  let missingCells = 0;
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
    if (!type) {
      missingCells += 1;
      return;
    }
    counts[placement.typeId] = (counts[placement.typeId] || 0) + 1;
    if (counts[placement.typeId] > type.quantity) overKeys.add(placementKey(placement.row, placement.col));
  });
  return { overKeys, missingCells };
}

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
  const { overKeys } = getCellFlags();
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const key = placementKey(row, col);
      const placement = map.get(key);
      const type = placement ? state.inventory.find((item) => item.id === placement.typeId) : null;
      const missing = Boolean(placement && !type);
      const over = Boolean(placement && overKeys.has(key));
      const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
      const char = type ? type.char : missing ? state.orphanChars[placement.typeId] || "？" : "";
      const title = missing ? ' title="字模缺失，请补字模或移除"' : over ? ' title="超出当前库存数量"' : "";
      cells.push(`
        <button class="cell ${type ? "used" : ""} ${missing ? "missing" : ""} ${over ? "over" : ""} ${vertical}" data-row="${row}" data-col="${col}" type="button" aria-label="第${row + 1}行第${col + 1}列"${title}>
          ${escapeHtml(char)}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function renderUsage() {
  const usage = getUsage();
  const entries = state.inventory.filter((item) => usage[item.id]);
  const { missingCells } = getCellFlags();
  els.placedCount.textContent = `${state.placements.length}个落字`;

  const shortages = entries.filter((item) => usage[item.id] > item.quantity);
  const problems = [];
  if (shortages.length) problems.push(`${shortages.length}处超量`);
  if (missingCells) problems.push(`${missingCells}格缺字`);
  els.shortageBadge.textContent = problems.length ? problems.join(" · ") : "数量充足";
  els.shortageBadge.className = `badge ${problems.length ? "warn" : "ok"}`;

  const selectedType = getSelectedType();
  els.selectedTypeLabel.textContent = selectedType ? `当前：${selectedType.char} · ${selectedType.style}` : "未选择字模";

  const missingUsage = Object.entries(usage).filter(([typeId]) => !state.inventory.some((item) => item.id === typeId));
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
  const missingHtml = missingUsage
    .map(
      ([typeId, used]) => `
        <div class="usage-item warn">
          <strong>${escapeHtml(state.orphanChars[typeId] || "？")} 字模缺失</strong>
          <span>${used}格缺字</span>
        </div>
      `
    )
    .join("");
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

function renderAutosaveBanner() {
  const snapshot = autosaveStore.current;
  const show = Boolean(pendingRestore && snapshot);
  els.autosaveBanner.hidden = !show;
  if (!show) return;
  const savedAt = new Date(snapshot.savedAt);
  const placementCount = Array.isArray(snapshot.placements) ? snapshot.placements.length : 0;
  els.autosaveMeta.textContent = `保存于 ${savedAt.toLocaleString("zh-CN")} · ${placementCount}个落字 · 放弃不影响已保存草稿`;
  const latestDraftAt = state.drafts.reduce((max, draft) => {
    const time = new Date(draft.savedAt).getTime();
    return Number.isFinite(time) && time > max ? time : max;
  }, 0);
  if (!latestDraftAt || savedAt.getTime() > latestDraftAt) {
    els.autosaveFresh.textContent = latestDraftAt ? "比最近草稿新" : "尚无已存草稿";
    els.autosaveFresh.className = "badge gold";
  } else {
    els.autosaveFresh.textContent = "早于最近草稿";
    els.autosaveFresh.className = "badge muted";
  }
}

function renderStorageNotice() {
  if (migrationError) {
    els.storageNotice.hidden = false;
    els.storageNotice.textContent = `旧存档迁移失败（${migrationError.message}），已保留原始存档，本次修改不会被保存。`;
    return;
  }
  const messages = [storageNotices.main, storageNotices.autosave].filter(Boolean);
  els.storageNotice.hidden = messages.length === 0;
  els.storageNotice.textContent = messages.join(" ");
}

function renderAll() {
  saveState();
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage();
  renderUsage();
  renderDrafts();
  renderAutosaveBanner();
  renderStorageNotice();
}

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
  renderAll();
  recordAutosave();
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
  renderAll();
  recordAutosave();
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
  renderAll();
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

els.paperSize.addEventListener("change", () => {
  state.settings.paperSize = els.paperSize.value;
  const { cols, rows } = getGrid();
  state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
  renderAll();
  recordAutosave();
});

els.flowMode.addEventListener("change", () => {
  state.settings.flowMode = els.flowMode.value;
  renderAll();
});

els.gridGap.addEventListener("input", () => {
  state.settings.gridGap = Number(els.gridGap.value);
  renderAll();
});

els.workTitle.addEventListener("input", () => {
  state.settings.workTitle = els.workTitle.value;
  saveState();
});

els.typeForm.addEventListener("submit", addType);
els.inventorySearch.addEventListener("input", renderInventory);
els.styleFilter.addEventListener("change", renderInventory);
els.saveDraftBtn.addEventListener("click", saveDraft);
els.exportBtn.addEventListener("click", exportPreview);
els.clearBoardBtn.addEventListener("click", () => {
  state.placements = [];
  renderAll();
  recordAutosave();
});

els.restoreAutosaveBtn.addEventListener("click", restoreAutosave);
els.discardAutosaveBtn.addEventListener("click", discardAutosave);

els.typeList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    const typeId = deleteButton.dataset.deleteType;
    state.inventory = state.inventory.filter((item) => item.id !== typeId);
    state.placements = state.placements.filter((item) => item.typeId !== typeId);
    if (state.selectedTypeId === typeId) state.selectedTypeId = state.inventory[0]?.id || null;
    renderAll();
    recordAutosave();
    return;
  }
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  state.selectedTypeId = card.dataset.typeId;
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
    renderAll();
    recordAutosave();
  }
  if (deleteButton) {
    state.drafts = state.drafts.filter((item) => item.id !== deleteButton.dataset.deleteDraft);
    renderAll();
  }
});

renderAll();
