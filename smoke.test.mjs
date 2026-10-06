// 冒烟测试：用 DOM/localStorage 桩加载 app.js，验证续排存档全流程
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");

function makeLocalStorage({ quota = Infinity } = {}) {
  let data = {};
  let failNextSet = 0;
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (failNextSet > 0) {
        failNextSet -= 1;
        throw new DOMException("quota", "QuotaExceededError");
      }
      // 覆盖语义：被写 key 的旧值不再占空间
      const size =
        Object.entries(data).reduce((acc, [key, val]) => acc + (key === k ? 0 : val.length), 0) + String(v).length;
      if (size > quota) throw new DOMException("quota", "QuotaExceededError");
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    _dump: () => ({ ...data }),
    _failNextSet: (n) => {
      failNextSet = n;
    }
  };
}

function makeElement(id) {
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    hidden: false,
    style: {},
    dataset: {},
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    closest() {
      return null;
    }
  };
}

function makeDOM() {
  const ids = [
    "paperSize", "flowMode", "gridGap", "workTitle", "stage", "typeList", "typeForm",
    "charInput", "styleInput", "sizeInput", "quantityInput", "wearInput",
    "inventorySearch", "styleFilter", "selectedTypeLabel", "shortageBadge", "usageList",
    "draftList", "placedCount", "inventoryCount", "saveDraftBtn", "exportBtn", "clearBoardBtn",
    "autosaveBanner", "autosaveMeta", "autosaveFresh", "restoreAutosaveBtn",
    "discardAutosaveBtn", "storageNotice"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
  return {
    elements,
    querySelector: (sel) => elements[sel.slice(1)] || null,
    createElement: () => makeElement("canvas")
  };
}

function loadApp(localStorage) {
  const document = makeDOM();
  const fn = new Function(
    "localStorage",
    "document",
    "crypto",
    "structuredClone",
    "DOMException",
    `${appSource}\n;return { getState: () => state, getAutosaveStore: () => autosaveStore, getMigrationError: () => migrationError, els, restoreAutosave, discardAutosave, recordAutosave, placeType, saveDraft };`
  );
  return fn(localStorage, document, crypto, structuredClone, DOMException);
}

let passed = 0;
function check(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ok - ${name}`);
  } else {
    console.error(`  FAIL - ${name}`);
    process.exitCode = 1;
  }
}

// --- 1. 全新加载：默认状态带新字段 ---
console.log("1. 全新加载");
{
  const ls = makeLocalStorage();
  const app = loadApp(ls);
  const state = app.getState();
  check("version 补齐为 2", state.version === 2);
  check("orphanChars 补齐为空对象", typeof state.orphanChars === "object" && state.orphanChars !== null);
  check("无续排存档时横幅隐藏", app.els.autosaveBanner.hidden === true);
}

// --- 2. 落字/换纸张触发自动存档，重开可恢复，且标注比草稿新 ---
console.log("2. 落字后自动存档 + 重开恢复");
{
  const ls = makeLocalStorage();
  let app = loadApp(ls);
  const state = app.getState();
  const typeId = state.inventory[0].id;
  app.placeType(0, 0, typeId);
  app.placeType(0, 1, typeId);
  check("落字后写入续排存档", Boolean(ls._dump()["zfl16-movable-type-workshop-autosave"]));
  const store = JSON.parse(ls._dump()["zfl16-movable-type-workshop-autosave"]);
  check("快照含版面/字模/设置", store.current.placements.length === 2 && store.current.inventory.length === 6 && store.current.settings.paperSize === "postcard");

  // 模拟关掉页面重开：主存档被清空（模拟师傅中途关页面丢版面），续排存档还在
  const autosaveRaw = ls._dump()["zfl16-movable-type-workshop-autosave"];
  const ls2 = makeLocalStorage();
  ls2.setItem("zfl16-movable-type-workshop-autosave", autosaveRaw);
  app = loadApp(ls2);
  check("重开后横幅出现", app.els.autosaveBanner.hidden === false);
  check("标注尚无草稿/比草稿新", app.els.autosaveFresh.textContent === "尚无已存草稿");
  check("元信息含落字数", app.els.autosaveMeta.textContent.includes("2个落字"));

  app.restoreAutosave();
  check("恢复后版面带回 2 个落字", app.getState().placements.length === 2);
  check("恢复后续排存档已清除", ls2._dump()["zfl16-movable-type-workshop-autosave"] === undefined);
  check("恢复后横幅隐藏", app.els.autosaveBanner.hidden === true);
}

// --- 3. 放弃只清续排存档，草稿照旧 ---
console.log("3. 放弃续排存档");
{
  const ls = makeLocalStorage();
  const app = loadApp(ls);
  app.placeType(1, 1, app.getState().inventory[0].id);
  app.saveDraft();
  const until = Date.now() + 5; // 保证续排存档时间戳晚于草稿
  while (Date.now() < until);
  app.placeType(2, 2, app.getState().inventory[0].id); // 草稿之后又落字 → 续排比草稿新
  const ls2 = makeLocalStorage();
  ls2.setItem("zfl16-movable-type-workshop", ls._dump()["zfl16-movable-type-workshop"]);
  ls2.setItem("zfl16-movable-type-workshop-autosave", ls._dump()["zfl16-movable-type-workshop-autosave"]);
  const app2 = loadApp(ls2);
  check("徽标显示比最近草稿新", app2.els.autosaveFresh.textContent === "比最近草稿新");
  app2.discardAutosave();
  check("放弃后续排存档被清掉", ls2._dump()["zfl16-movable-type-workshop-autosave"] === undefined);
  check("已保存草稿照旧", app2.getState().drafts.length === 1);
  check("横幅隐藏", app2.els.autosaveBanner.hidden === true);
}

// --- 4. 库存变化后恢复：按当前库存重算，缺字/超量标出 ---
console.log("4. 恢复时按当前库存重算");
{
  const ls = makeLocalStorage();
  const app = loadApp(ls);
  const state = app.getState();
  const typeA = state.inventory[0].id; // 山，quantity 4
  const typeB = state.inventory[1].id; // 月，quantity 3
  app.placeType(0, 0, typeA);
  app.placeType(0, 1, typeA);
  app.placeType(1, 0, typeB);

  // 重开前：当前库存里删掉字模 B（变缺字），A 的数量不变但落 2 字没问题；
  // 再手动把 A 的库存改成 1（落 2 字 → 第 2 格超量）
  const mainRaw = JSON.parse(ls._dump()["zfl16-movable-type-workshop"]);
  mainRaw.inventory = mainRaw.inventory.filter((i) => i.id !== typeB);
  mainRaw.inventory.find((i) => i.id === typeA).quantity = 1;
  mainRaw.placements = []; // 模拟版面丢失
  const ls2 = makeLocalStorage();
  ls2.setItem("zfl16-movable-type-workshop", JSON.stringify(mainRaw));
  ls2.setItem("zfl16-movable-type-workshop-autosave", ls._dump()["zfl16-movable-type-workshop-autosave"]);
  const app2 = loadApp(ls2);
  app2.restoreAutosave();
  const restored = app2.getState();
  check("恢复出 3 个落字", restored.placements.length === 3);
  check("缺字字模字符被记住", restored.orphanChars[typeB] === "月");
  check("当前库存数量不被旧数字顶上去", restored.inventory.find((i) => i.id === typeA).quantity === 1);
  const stageHtml = app2.els.stage.innerHTML;
  check("缺字格子标出 missing", stageHtml.includes("missing"));
  check("超量格子标出 over", stageHtml.includes("over"));
  check("徽标提示缺字与超量", app2.els.shortageBadge.textContent.includes("缺字") && app2.els.shortageBadge.textContent.includes("超量"));
}

// --- 5. 容量到顶：降级只留最新一份；全失败时保留上一份 ---
console.log("5. 存储容量降级");
{
  const ls = makeLocalStorage();
  const app = loadApp(ls);
  const typeId = app.getState().inventory[0].id;
  app.placeType(0, 0, typeId);
  app.placeType(0, 1, typeId); // 此时 store 有 current + prev

  // 把配额卡到「放得下旧双份 + 降级单份，但放不下新双份」：
  // 先无损装载一次，量出主存档与旧续排存档的实际字节数，再按这个尺寸开配额
  const ls2 = makeLocalStorage();
  ls2.setItem("zfl16-movable-type-workshop", ls._dump()["zfl16-movable-type-workshop"]);
  ls2.setItem("zfl16-movable-type-workshop-autosave", ls._dump()["zfl16-movable-type-workshop-autosave"]);
  const probe = loadApp(ls2);
  const mainSize = JSON.stringify(probe.getState()).length;
  const oldStoreSize = ls2._dump()["zfl16-movable-type-workshop-autosave"].length;

  const ls3 = makeLocalStorage({ quota: mainSize + oldStoreSize });
  ls3.setItem("zfl16-movable-type-workshop", ls2._dump()["zfl16-movable-type-workshop"]);
  ls3.setItem("zfl16-movable-type-workshop-autosave", ls2._dump()["zfl16-movable-type-workshop-autosave"]);
  const app2 = loadApp(ls3);
  app2.placeType(0, 2, app2.getState().inventory[0].id);
  const store = JSON.parse(ls3._dump()["zfl16-movable-type-workshop-autosave"]);
  check("降级后只留最新一份", store.prev === null && store.current.placements.length === 3);
  check("提示已降级", app2.els.storageNotice.textContent.includes("降级"));

  // 连降级也写不进去 → 上一份保留
  const ls4 = makeLocalStorage({ quota: 10 });
  ls4._failNextSet(2); // 两次 setItem 都抛错
  const app3 = loadApp(ls4);
  app3.placeType(0, 0, app3.getState().inventory[0].id);
  check("写入失败提示保留上一份", app3.els.storageNotice.textContent.includes("上一份"));
}

// --- 6. 迁移：旧数据补新字段；迁移出错保留原存档并说明 ---
console.log("6. 数据迁移");
{
  // 旧版 v1 数据（无 version / orphanChars）
  const ls = makeLocalStorage();
  ls.setItem(
    "zfl16-movable-type-workshop",
    JSON.stringify({
      inventory: [{ id: "t1", char: "山", style: "宋体", size: 30, quantity: 4, wear: "新" }],
      selectedTypeId: "t1",
      placements: [{ row: 0, col: 0, typeId: "t1" }],
      drafts: [{ id: "d1", title: "旧草稿", settings: { paperSize: "square" }, placements: [], savedAt: "2026-01-01T00:00:00Z" }],
      settings: { paperSize: "square", flowMode: "vertical", gridGap: 10, workTitle: "旧作" }
    })
  );
  const app = loadApp(ls);
  const state = app.getState();
  check("迁移后补 version", state.version === 2);
  check("迁移后补 orphanChars", typeof state.orphanChars === "object");
  check("草稿字段补齐", state.drafts[0].settings.flowMode === "horizontal");
  check("旧设置保留", state.settings.paperSize === "square");
  check("迁移无错误", app.getMigrationError() === null);

  // 损坏数据：inventory 不是数组 → 迁移失败
  const ls2 = makeLocalStorage();
  const corrupt = JSON.stringify({ inventory: "broken", placements: [] });
  ls2.setItem("zfl16-movable-type-workshop", corrupt);
  const app2 = loadApp(ls2);
  check("迁移出错被捕获", app2.getMigrationError() !== null);
  app2.placeType(0, 0, "whatever");
  check("原存档未被覆盖", ls2._dump()["zfl16-movable-type-workshop"] === corrupt);
  check("界面说明迁移失败", app2.els.storageNotice.textContent.includes("迁移失败") && app2.els.storageNotice.textContent.includes("保留原始存档"));
}

console.log(`\n${passed} 项检查通过${process.exitCode ? "，但有失败项" : ""}`);
