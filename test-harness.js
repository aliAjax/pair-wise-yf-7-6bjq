// 测试桩：模拟 DOM 与 localStorage，验证 app.js 的存档/续排/核对逻辑
const fs = require("fs");
const path = require("path");

/* ---------- 假 DOM 元素 ---------- */
class FakeElement {
  constructor() {
    this.value = "";
    this.innerHTML = "";
    this.textContent = "";
    this.className = "";
    this.hidden = false;
    this.style = {};
    this.dataset = {};
    this._listeners = {};
  }
  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }
  dispatch(type, event = {}) {
    (this._listeners[type] || []).forEach((fn) => fn({ target: this, preventDefault() {}, ...event }));
  }
  closest() { return null; }
  appendChild() {}
  querySelector() { return new FakeElement(); }
}

const harnessEls = {};
globalThis.document = {
  querySelector: (sel) => {
    if (!harnessEls[sel]) harnessEls[sel] = new FakeElement();
    return harnessEls[sel];
  },
  createElement: () => new FakeElement()
};

/* ---------- 假 localStorage（可模拟容量上限） ---------- */
const memory = new Map();
let quotaLimit = Infinity;
let setItemCalls = 0;
let failNextSet = null;

global.localStorage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) {
    setItemCalls += 1;
    if (failNextSet && failNextSet.key === key && setItemCalls <= failNextSet.count) {
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      throw err;
    }
    const total = [...memory.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0) + key.length + value.length;
    if (total > quotaLimit) {
      const err = new Error("quota");
      err.name = "QuotaExceededError";
      throw err;
    }
    memory.set(key, value);
  },
  removeItem(key) { memory.delete(key); },
  key(i) { return [...memory.keys()][i]; },
  get length() { return memory.size; }
};

/* ---------- 载入 app.js，并导出内部绑定 ---------- */
let code = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
code += `
;globalThis.__app = {
  state, els, STORAGE_VERSION,
  placeType, saveState, saveResume, loadState, loadResume,
  checkResumeOnLoad, applyResume, discardResume,
  getUsage, analyzePlacements, renderAll, persist,
  freeRedundantCopies, storageSet, migrateState, notify
};`;
eval(code);
const A = globalThis.__app;

/* ---------- 测试工具 ---------- */
let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log("  PASS", msg); }
  else { failed += 1; console.log("  FAIL", msg); }
}

const storageKey = "zfl16-movable-type-workshop";
const resumeKey = "zfl16-movable-type-workshop-resume";

/* ---------- 用例 ---------- */

console.log("== 初始：无存档，不应写续排 ==");
assert(memory.get(resumeKey) == null, "首次打开不产生续排存档");

console.log("== 落字后自动续排 ==");
const firstTypeId = A.state.inventory[0].id;
A.state.selectedTypeId = firstTypeId;
A.placeType(0, 0);
assert(memory.get(resumeKey) != null, "落字后写入续排存档");
const resume = JSON.parse(memory.get(resumeKey));
assert(resume.state.placements.length === 1 && resume.state.placements[0].typeId === firstTypeId, "续排内容含版面与字模");
assert(resume.state.inventory.length === A.state.inventory.length, "续排内容含字模库");
assert(resume.savedAt != null, "续排带时间戳");

console.log("== 重新打开：续排比最新草稿新 -> 出现横幅 ==");
A.state.drafts = [{
  id: "old-draft", title: "旧稿", settings: structuredClone(A.state.settings),
  placements: [], savedAt: new Date(Date.now() - 100000).toISOString()
}];
A.saveState();
A.checkResumeOnLoad();
assert(harnessEls["#resumeBanner"].hidden === false, "检测到比草稿新的续排，横幅出现");
assert(harnessEls["#resumeMessage"].textContent.includes("最近一次草稿"), "横幅文案提到最近草稿");

console.log("== 放弃续排：清掉续排，草稿照旧 ==");
A.discardResume();
assert(memory.get(resumeKey) == null, "放弃后续排存档被清除");
assert(A.state.drafts.length === 1 && A.state.drafts[0].id === "old-draft", "已保存草稿不受影响");
assert(harnessEls["#resumeBanner"].hidden === true, "横幅收起");

console.log("== 续排比草稿旧 -> 不提示 ==");
A.state.drafts = [{
  id: "new-draft", title: "新稿", settings: structuredClone(A.state.settings),
  placements: [], savedAt: new Date(Date.now() + 100000).toISOString()
}];
A.checkResumeOnLoad();
assert(harnessEls["#resumeBanner"].hidden === true, "续排较旧时不提示");

console.log("== 字模数量变化：缺字与超量格子标出 ==");
A.state.drafts = [];
A.state.placements = [];
for (let i = 0; i < 5; i += 1) A.placeType(0, i);
const doomedId = A.state.inventory[1].id;
A.state.placements.push({ row: 2, col: 2, typeId: doomedId });
A.state.inventory = A.state.inventory.filter((it) => it.id !== doomedId);
A.renderAll();
const stageHtml = harnessEls["#stage"].innerHTML;
assert(stageHtml.includes("缺"), "缺字格子标出「缺」");
assert(stageHtml.includes("超"), "超量格子标出「超」");
assert(harnessEls["#shortageBadge"].textContent.includes("缺字") && harnessEls["#shortageBadge"].textContent.includes("超量"), "角标显示缺字·超量");
const usage = A.getUsage();
assert(usage[firstTypeId] === 5, "用量按当前落字重算为 5");

console.log("== 迁移：旧数据补齐新字段 ==");
memory.set(storageKey, JSON.stringify({
  inventory: [{ id: "x1", char: "天", style: "宋体", size: 30, quantity: 2, wear: "新" }],
  placements: [],
  settings: { paperSize: "bookmark" }
}));
const migrated = A.loadState();
assert(migrated.version === A.STORAGE_VERSION, "迁移补 version 字段");
assert(migrated.settings.flowMode === "horizontal", "迁移补 flowMode 默认值");
assert(migrated.settings.gridGap === 8, "迁移补 gridGap 默认值");
assert(Array.isArray(migrated.drafts) && migrated.drafts.length === 0, "迁移补 drafts 字段");
assert(migrated.inventory[0].id === "x1", "迁移保留原字模");

console.log("== 迁移出错：保留原存档并说明 ==");
memory.set(storageKey, "{ 这不是合法JSON");
const before = memory.get(storageKey);
A.loadState();
assert(memory.get(storageKey) === before, "解析失败时原存档未被覆盖");
assert(harnessEls["#notice"].hidden === false && harnessEls["#notice"].textContent.includes("保留原存档"), "给出说明通知");

console.log("== 容量到顶：降级只留最新一份；再失败回滚上一份 ==");
A.state.placements = [{ row: 0, col: 0, typeId: firstTypeId }];
A.saveResume();
const goodResume = memory.get(resumeKey);
assert(goodResume != null, "先写入一份续排");
quotaLimit = 10;
A.saveResume();
const after = memory.get(resumeKey);
assert(after != null, "降级后续排仍保留最新一份");
setItemCalls = 0;
failNextSet = { key: resumeKey, count: 5 };
A.saveResume();
const rolled = memory.get(resumeKey);
assert(rolled != null, "保存失败后恢复上一份存档");
quotaLimit = Infinity;
failNextSet = null;

console.log("== 改字模 / 换纸张触发续排 ==");
A.state.placements = [];
A.state.inventory = A.state.inventory.filter((it) => it.id !== A.state.inventory[0].id);
A.persist();
assert(memory.get(resumeKey) != null, "删除字模（改字模）后续排更新");
harnessEls["#paperSize"].value = "bookmark";
harnessEls["#paperSize"].dispatch("change");
assert(memory.get(resumeKey) != null, "换纸张后续排更新");
const r2 = JSON.parse(memory.get(resumeKey));
assert(r2.state.settings.paperSize === "bookmark", "续排记录当前纸张设置");

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
