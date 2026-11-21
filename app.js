/* Sổ điểm học sinh – lưu dữ liệu trong localStorage của trình duyệt */
(function () {
  'use strict';

  const STORAGE_KEY = 'so-diem-data-v1';
  const UI_KEY = 'so-diem-ui-v1';
  const DEFAULT_SESSIONS = 10;

  const DEFAULT_CLASSES = [
    { id: '7', name: 'Lớp 7' },
    { id: '8', name: 'Lớp 8' },
    { id: '9.1', name: '9.1', group: 'Lớp 9' },
    { id: '9.2', name: '9.2', group: 'Lớp 9' },
    { id: '9.S', name: '9.S', group: 'Lớp 9' },
    { id: 'ielts', name: 'Lớp IELTS', notes: [
      { key: 'btvn', label: 'Ghi chú kiểm tra BTVN' },
      { key: 'ktdg', label: 'Nội dung bài KT đầu giờ' },
    ] },
  ];
  // Danh sách lớp có thể thêm / xoá (lưu trong state.config, đồng bộ qua doc "_config")
  let CLASSES = DEFAULT_CLASSES.map(c => Object.assign({}, c));
  let TRASH = [];   // lớp đã xoá – vẫn giữ dữ liệu, khôi phục được
  const CONFIG_DOC = '_config';

  const SHEETS = [
    { id: 'trenlop', name: 'Điểm trên lớp', type: 'sessions' },
    { id: 'khaosat', name: 'Điểm khảo sát', type: 'sessions', target: true },
    { id: 'nhanxet', name: 'Nhận xét', type: 'review' },
    { id: 'kehoach', name: 'Kế hoạch IELTS', type: 'plan' },
  ];

  // Các cột nhỏ mặc định trong mỗi buổi (có thể thêm / xoá trên giao diện)
  const DEFAULT_COLS = [
    { key: 'dd', label: 'Điểm danh', type: 'attend' },
    { key: 'btvn', label: 'BTVN', type: 'check' },
    { key: 'chepnghe', label: 'Chép nghe', type: 'check' },
    { key: 'chepphat', label: 'Chép phạt', type: 'check' },
    { key: 'nghe', label: 'Điểm nghe', type: 'score' },
    { key: 'tumoi', label: 'Điểm từ mới', type: 'score' },
    { key: 'kttt', label: 'Điểm kiến thức trọng tâm', type: 'score' },
    { key: 'ktdg', label: 'Điểm KT đầu giờ', type: 'score' },
  ];

  // Mỗi buổi một màu (sắc độ HSL)
  const SESSION_HUES = [262, 199, 152, 28, 330, 222, 174, 8, 290, 45, 110, 240];

  const FONTS = [
    { name: 'Be Vietnam Pro', css: "'Be Vietnam Pro', system-ui, sans-serif" },
    { name: 'Nunito', css: "'Nunito', system-ui, sans-serif" },
    { name: 'Quicksand', css: "'Quicksand', system-ui, sans-serif" },
    { name: 'Lexend', css: "'Lexend', system-ui, sans-serif" },
    { name: 'Montserrat', css: "'Montserrat', system-ui, sans-serif" },
    { name: 'Inter', css: "'Inter', system-ui, sans-serif" },
    { name: 'Roboto', css: "'Roboto', system-ui, sans-serif" },
    { name: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    { name: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  ];
  const SIZES = [12, 13, 14, 15, 16, 18, 20];

  const SKILLS = ['', 'Listening', 'Reading', 'Writing', 'Speaking', 'Vocabulary', 'Grammar', 'Mock test', 'Khác'];

  // ---------- State ----------
  let state = load(STORAGE_KEY) || { classes: {} };
  if (!state.classes) state.classes = {};
  const ui = Object.assign({ cls: '7', sheet: 'trenlop', session: 'all', font: FONTS[0].name, size: 14 }, load(UI_KEY) || {});
  applyConfig(state.config);
  if (!state.config) state.config = { classes: clone(CLASSES), trash: clone(TRASH) };
  if (!CLASSES.some(c => c.id === ui.cls)) ui.cls = CLASSES.length ? CLASSES[0].id : '7';

  function applyConfig(cfg) {
    if (cfg && Array.isArray(cfg.classes)) {
      CLASSES = cfg.classes.map(c => Object.assign({}, c));
      TRASH = Array.isArray(cfg.trash) ? cfg.trash.map(c => Object.assign({}, c)) : [];
    } else {
      CLASSES = DEFAULT_CLASSES.map(c => Object.assign({}, c));
      TRASH = [];
    }
  }
  function configObj() { return { classes: clone(CLASSES), trash: clone(TRASH) }; }
  function saveConfig() {
    state.config = configObj();
    sync(COL_CLASSES, CONFIG_DOC, ['classes'], state.config.classes);
    sync(COL_CLASSES, CONFIG_DOC, ['trash'], state.config.trash);
    save();
  }
  if (!ui.reviewMonths || typeof ui.reviewMonths !== 'object') ui.reviewMonths = {};
  validSheet();

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  let saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { alert('Không lưu được dữ liệu: ' + e.message); }
  }
  function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* ignore */ } }
  window.addEventListener('beforeunload', () => { saveNow(); flush(); });

  // ---------- Đồng bộ chung qua Firebase (xem cloud.js) ----------
  // Firestore: collection "sodiem_classes" (doc = lớp, chứa danh sách HS)
  //            collection "sodiem_sheets"  (doc = "<lớp>__<sheet>", chứa điểm)
  const COL_CLASSES = 'sodiem_classes';
  const COL_SHEETS = 'sodiem_sheets';
  let cloud = null;
  const pending = {};      // thay đổi chưa gửi: "col\u0001id" -> [[path, value], ...]
  const remote = {};       // bản dữ liệu mới nhất từ máy chủ: "col\u0001id" -> object
  let flushTimer = null;
  let inflight = 0;

  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function sheetDocId(cid, sid) { return cid + '__' + sid; }
  function setPath(obj, path, value, del) {
    let o = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (!o[path[i]] || typeof o[path[i]] !== 'object' || Array.isArray(o[path[i]])) o[path[i]] = {};
      o = o[path[i]];
    }
    const last = path[path.length - 1];
    if (value === undefined && !del) delete o[last];
    else o[last] = value;
  }

  // ---------- Hoàn tác / Làm lại ----------
  // Mỗi thay đổi của mình đều đi qua sync(col, id, path, value). Ta ghi lại đường dẫn đã sửa,
  // so với bản chụp "baseline" (trạng thái trước khi sửa) để biết giá trị cũ / mới.
  // Hoàn tác chỉ trả lại đúng các ô mình đã sửa, không đụng tới thay đổi của người khác.
  const UNDO_LIMIT = 100;
  let undoStack = [], redoStack = [];
  let baseline = null;          // bản chụp state trước thao tác đang mở
  let touched = null;           // Map "col|id|path" -> {col, id, path}
  let undoTimer = null;
  let replaying = false;

  function undoTouch(col, id, path) {
    if (replaying) return;
    if (!touched) touched = new Map();
    const k = col + '\u0001' + id + '\u0001' + path.join('\u0001');
    if (!touched.has(k)) touched.set(k, { col, id, path: path.slice(), view: { cls: ui.cls, sheet: ui.sheet } });
    clearTimeout(undoTimer);
    undoTimer = setTimeout(commitUndo, 800);
    updateUndoButtons();
  }
  function takeBaseline() { if (!touched) baseline = clone(state); }

  /** Đọc / ghi giá trị theo (col, id, path) trên một bản state bất kỳ */
  function locate(root, col, id) {
    if (col === COL_SHEETS) {
      const i = id.lastIndexOf('__');
      const cid = id.slice(0, i), sid = id.slice(i + 2);
      const c = root.classes[cid] || (root.classes[cid] = { students: [], sheets: {} });
      if (!c.sheets) c.sheets = {};
      return { kind: 'sheet', obj: c.sheets[sid] || (c.sheets[sid] = {}) };
    }
    if (id === CONFIG_DOC) return { kind: 'config', obj: root.config || (root.config = { classes: clone(DEFAULT_CLASSES), trash: [] }) };
    const c = root.classes[id] || (root.classes[id] = { students: [], sheets: {} });
    if (!c.students) c.students = [];
    return { kind: 'class', obj: c };
  }
  function getAt(root, col, id, path) {
    const L = locate(root, col, id);
    if (L.kind === 'class') {
      if (path[0] !== 'students') return undefined;
      const st = L.obj.students.find(s => s.id === path[1]);
      if (!st) return undefined;
      if (path.length === 2) return { name: st.name, order: st.order || 0 };
      return st[path[2]];
    }
    let o = L.obj;
    for (const k of path) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; }
    return clone(o);
  }
  function setAt(root, col, id, path, value) {
    const L = locate(root, col, id);
    if (L.kind === 'class') {
      if (path[0] !== 'students') return;
      const list = L.obj.students;
      let st = list.find(s => s.id === path[1]);
      if (path.length === 2) {
        if (value === undefined) { L.obj.students = list.filter(s => s.id !== path[1]); return; }
        if (!st) { st = { id: path[1] }; list.push(st); }
        st.name = value.name; st.order = value.order;
      } else {
        if (!st) return;
        if (value === undefined) delete st[path[2]]; else st[path[2]] = value;
      }
      L.obj.students.sort((a, b) => (a.order || 0) - (b.order || 0));
      return;
    }
    setPath(L.obj, path, clone(value));
  }

  function commitUndo() {
    clearTimeout(undoTimer);
    if (!touched) return;
    const ops = [];
    let view = null;
    touched.forEach(t => {
      const before = baseline ? getAt(baseline, t.col, t.id, t.path) : undefined;
      const after = getAt(state, t.col, t.id, t.path);
      if (JSON.stringify(before) !== JSON.stringify(after)) ops.push({ col: t.col, id: t.id, path: t.path, before, after });
      if (!view) view = t.view;
    });
    touched = null;
    baseline = clone(state);
    if (!ops.length) return;
    undoStack.push({ ops, view, label: undoLabel(ops) });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
  }
  function undoLabel(ops) {
    const p = ops[0].path[0], n = ops.length;
    if (ops[0].id === CONFIG_DOC) return 'thay đổi lớp';
    if (p === 'students') return n > 2 ? 'thay đổi danh sách học sinh' : 'sửa học sinh';
    if (p === 'cols') return 'thay đổi cột';
    if (p === 'sessions') return 'thay đổi buổi';
    if (p === 'rows') return 'sửa kế hoạch';
    if (p === 'notes') return 'sửa ghi chú';
    if (p === 'items') return 'sửa nhận xét';
    if (p === 'targets') return 'sửa điểm mục tiêu';
    if (p === 'totals') return 'sửa tổng số câu';
    return n > 1 ? `sửa ${n} ô` : 'sửa ô';
  }
  function replay(entry, which) {
    replaying = true;
    // áp dụng ngược thứ tự khi hoàn tác để các thao tác nhiều bước trả về đúng
    const ops = which === 'before' ? entry.ops.slice().reverse() : entry.ops;
    ops.forEach(op => {
      setAt(state, op.col, op.id, op.path, op[which]);
      sync(op.col, op.id, op.path, op[which]);
    });
    replaying = false;
    if (ops.some(op => op.id === CONFIG_DOC && op.col === COL_CLASSES)) applyConfig(state.config);
    baseline = clone(state);
    save();
    if (entry.view) {
      const okCls = CLASSES.some(c => c.id === entry.view.cls);
      if (okCls) ui.cls = entry.view.cls;
      ui.sheet = entry.view.sheet;
    }
    if (!CLASSES.some(c => c.id === ui.cls)) ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls;
    saveUI();
    renderClassTabs();
    renderSheetTabs();
    renderToolbar();
    renderContent();
    if ($('#classDialog') && $('#classDialog').open) renderClassManager();
  }
  function blurEditing() {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
  }
  function doUndo() {
    blurEditing();
    commitUndo();
    const e = undoStack.pop();
    if (!e) return;
    replay(e, 'before');
    redoStack.push(e);
    updateUndoButtons(`↶ Đã hoàn tác: ${e.label}`);
  }
  function doRedo() {
    blurEditing();
    commitUndo();
    const e = redoStack.pop();
    if (!e) return;
    replay(e, 'after');
    undoStack.push(e);
    updateUndoButtons(`↷ Đã làm lại: ${e.label}`);
  }
  function resetUndo() {
    clearTimeout(undoTimer);
    if (!state.config) state.config = configObj();
    undoStack = []; redoStack = []; touched = null; baseline = clone(state);
    updateUndoButtons();
  }
  let toastTimer = null;
  function updateUndoButtons(msg) {
    const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
    if (u) { u.disabled = !undoStack.length && !touched; u.title = undoStack.length ? `Hoàn tác: ${undoStack[undoStack.length - 1].label} (Ctrl+Z)` : 'Hoàn tác (Ctrl+Z)'; }
    if (r) { r.disabled = !redoStack.length; r.title = redoStack.length ? `Làm lại: ${redoStack[redoStack.length - 1].label} (Ctrl+Y)` : 'Làm lại (Ctrl+Y)'; }
    if (msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
    }
  }

  /** Ghi một thay đổi lên đám mây (value === undefined nghĩa là xoá) */
  function sync(col, id, path, value) {
    undoTouch(col, id, path);
    if (!cloud) return;
    const k = col + '\u0001' + id;
    (pending[k] = pending[k] || []).push([path, clone(value)]);
    setStatus('saving');
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 400);
  }

  function flush() {
    clearTimeout(flushTimer);
    if (!cloud) return;
    Object.keys(pending).forEach(k => {
      const ops = pending[k];
      delete pending[k];
      const [col, id] = k.split('\u0001');
      const patch = {};
      ops.forEach(([path, value]) => setPath(patch, path, value === undefined ? cloud.DELETE : value, true));
      inflight++;
      cloud.write(col, id, patch)
        .then(() => { inflight--; if (!inflight && !Object.keys(pending).length) setStatus('saved'); })
        .catch(err => { inflight--; setStatus('error', err); });
    });
  }

  /** Dữ liệu máy chủ + các thay đổi mình chưa kịp gửi */
  function withPending(col, id, data) {
    const d = clone(data) || {};
    (pending[col + '\u0001' + id] || []).forEach(([path, value]) => setPath(d, path, value));
    return d;
  }

  function studentsFromMap(map) {
    return Object.entries(map || {})
      .filter(([, v]) => v && typeof v === 'object')
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0) || a[0].localeCompare(b[0]))
      .map(([id, v]) => ({ id, name: v.name || '', order: v.order || 0 }));
  }

  function applyDoc(col, id, data) {
    remote[col + '\u0001' + id] = data;
    const d = withPending(col, id, data);
    if (col === COL_CLASSES) {
      if (id === CONFIG_DOC) {
        state.config = d && Array.isArray(d.classes) ? d : undefined;
        applyConfig(state.config);
        return;
      }
      classData(id).students = studentsFromMap(d.students);
    } else if (col === COL_SHEETS) {
      const i = id.lastIndexOf('__');
      if (i <= 0) return;
      const cid = id.slice(0, i), sid = id.slice(i + 2);
      if (!sheetDef(sid)) return;
      classData(cid).sheets[sid] = d;
    }
  }

  function viewSnapshot() {
    const extra = ui.sheet === 'nhanxet' ? [sheetData(ui.cls, 'khaosat'), ...scoreSheetsOf(ui.cls).map(m => sheetData(ui.cls, m.id))] : null;
    return JSON.stringify([classData(ui.cls).students, sheetData(ui.cls, ui.sheet), extra]);
  }
  function configSnapshot() { return JSON.stringify([CLASSES, TRASH]); }

  let remoteRenderTimer = null;
  function onRemoteDoc(col, id, data) {
    const cfgBefore = configSnapshot();
    const before = viewSnapshot();
    applyDoc(col, id, data);
    save();
    takeBaseline();
    if (configSnapshot() !== cfgBefore) {
      if (!CLASSES.some(c => c.id === ui.cls)) { ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls; ui.session = 'all'; }
      validSheet();
      renderClassTabs();
      renderSheetTabs();
      if ($('#classDialog').open) renderClassManager();
    }
    if (viewSnapshot() === before) return;
    clearTimeout(remoteRenderTimer);
    remoteRenderTimer = setTimeout(() => renderKeepFocus(), 120);
  }

  function hasLocalData() {
    return Object.values(state.classes).some(c => (c.students && c.students.length) ||
      Object.values(c.sheets || {}).some(sh => sh.rows && sh.rows.length));
  }

  /** Đẩy toàn bộ dữ liệu trên máy này lên đám mây (lần đầu, hoặc khi khôi phục) */
  function uploadAll() {
    const jobs = [];
    jobs.push(cloud.replace(COL_CLASSES, CONFIG_DOC, configObj()));
    Object.keys(state.classes).forEach(cid => {
      if (!CLASSES.some(c => c.id === cid) && !TRASH.some(c => c.id === cid)) return;
      const c = classData(cid);
      const map = {};
      c.students.forEach((s, i) => { map[s.id] = { name: s.name, order: s.order || i + 1 }; });
      jobs.push(cloud.replace(COL_CLASSES, cid, { students: map }));
      Object.keys(c.sheets).forEach(sid => {
        if (!sheetDef(sid)) return;
        jobs.push(cloud.replace(COL_SHEETS, sheetDocId(cid, sid), clone(sheetData(cid, sid))));
      });
    });
    setStatus('saving');
    return Promise.all(jobs).then(() => setStatus('saved'), err => setStatus('error', err));
  }

  function setStatus(kind, err) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const map = {
      local: ['💾 Chỉ lưu trên máy này', 'Chưa kết nối Firebase: điểm chỉ lưu trên trình duyệt này.'],
      loading: ['⏳ Đang tải dữ liệu chung…', ''],
      saving: ['⏳ Đang lưu…', ''],
      saved: ['☁️ Đã lưu chung', 'Mọi người mở link đều thấy và sửa được cùng một bảng điểm.'],
      error: ['⚠️ Lỗi đồng bộ', 'Không lưu được lên máy chủ: ' + (err && err.message ? err.message : err)],
    };
    const [text, title] = map[kind] || map.local;
    el.textContent = text;
    el.title = title;
    el.className = 'sync ' + kind;
    if (kind === 'error') console.error('Lỗi đồng bộ:', err);
  }

  /** cloud.js gọi hàm này khi đã kết nối Firebase */
  async function connectCloud(adapter) {
    cloud = adapter;
    setStatus('loading');
    try {
      const all = await adapter.loadAll([COL_CLASSES, COL_SHEETS]);
      const empty = !all[COL_CLASSES].length && !all[COL_SHEETS].length;
      if (empty && hasLocalData()) {
        await uploadAll();
      } else {
        state = { classes: {} };
        applyConfig(undefined);
        all[COL_CLASSES].forEach(d => applyDoc(COL_CLASSES, d.id, d.data));
        if (!CLASSES.some(c => c.id === ui.cls)) { ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls; ui.session = 'all'; }
        all[COL_SHEETS].forEach(d => applyDoc(COL_SHEETS, d.id, d.data));
        saveNow();
        renderAll();
      }
      setStatus('saved');
      resetUndo();
      adapter.subscribe([COL_CLASSES, COL_SHEETS], onRemoteDoc, err => setStatus('error', err));
    } catch (err) {
      setStatus('error', err);
    }
  }
  window.SoDiem = { connectCloud, setStatus };

  function classData(cid) {
    if (!state.classes[cid]) state.classes[cid] = { students: [], sheets: {} };
    const c = state.classes[cid];
    if (!c.students) c.students = [];
    if (!c.sheets) c.sheets = {};
    return c;
  }
  // Sheet theo tháng: id "mon_…", lưu trong cấu hình lớp (class.months)
  function findMonth(mid) {
    for (const c of [...CLASSES, ...TRASH]) {
      const m = (c.months || []).find(x => x.id === mid) || (c.monthsTrash || []).find(x => x.id === mid);
      if (m) return m;
    }
    return null;
  }
  function sheetDef(sid) {
    const f = SHEETS.find(s => s.id === sid);
    if (f) return f;
    if (typeof sid === 'string' && sid.startsWith('mon_')) {
      const m = findMonth(sid);
      return { id: sid, name: m ? m.name : 'Tháng', type: 'sessions', month: true };
    }
    return undefined;
  }
  function classEntry(cid) { return CLASSES.find(c => c.id === cid) || TRASH.find(c => c.id === cid); }
  const BASE_MONTH = 'Tháng 11';   // sheet "Điểm trên lớp" hiện có của mọi lớp là tháng 11
  function baseMonthName(cid) { return (classEntry(cid) || {}).baseMonth || BASE_MONTH; }
  function isClassScore(sid) { return sid === 'trenlop' || (typeof sid === 'string' && sid.startsWith('mon_')); }
  /** Các sheet điểm trên lớp của lớp, theo thứ tự tháng: [{id, name}] */
  function scoreSheetsOf(cid) {
    return [{ id: 'trenlop', name: baseMonthName(cid) }, ...(((classEntry(cid) || {}).months) || []).map(m => ({ id: m.id, name: m.name }))];
  }
  function sheetTitle(cid, sid) {
    if (isClassScore(sid)) {
      const m = scoreSheetsOf(cid).find(x => x.id === sid);
      return 'Điểm trên lớp – ' + (m ? m.name : '');
    }
    return (sheetDef(sid) || {}).name || '';
  }
  function sheetsOf(cid) {
    const months = ((classEntry(cid) || {}).months || []).map(m => sheetDef(m.id));
    return [SHEETS[0], ...months, SHEETS[1], SHEETS[2], SHEETS[3]];
  }
  function validSheet() {
    if (!sheetsOf(ui.cls).some(s => s.id === ui.sheet)) { ui.sheet = 'trenlop'; ui.session = 'all'; }
  }
  function sheetData(cid, sid) {
    const c = classData(cid);
    const type = sheetDef(sid).type;
    if (!c.sheets[sid]) c.sheets[sid] = type === 'plan' ? { rows: [] } : type === 'review' ? { items: {} } : {};
    const sh = c.sheets[sid];
    if (type === 'review') {
      if (!sh.items || typeof sh.items !== 'object') sh.items = {};
    } else if (type === 'sessions') {
      if (!sh.totals) sh.totals = {};
      if (!sh.data) sh.data = {};
      if (sheetDef(sid).target && !sh.targets) sh.targets = {};
      if (!Array.isArray(sh.sessions)) sh.sessions = Array.from({ length: DEFAULT_SESSIONS }, (_, i) => ({ id: String(i + 1) }));
      if (!Array.isArray(sh.cols)) sh.cols = DEFAULT_COLS.map(c => Object.assign({}, c));
    } else if (!sh.rows) sh.rows = [];
    return sh;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- Tính toán ----------
  function num(v) {
    if (v === '' || v === null || v === undefined || v === true || v === false) return null;
    const n = Number(typeof v === 'string' ? v.trim().replace(',', '.') : v);
    return Number.isFinite(n) ? n : null;
  }
  /** Quy đổi số câu đúng ra điểm /10 dựa trên tổng số câu của bài */
  function toTen(correct, total) {
    const c = num(correct), t = num(total);
    if (c === null || t === null || t <= 0) return null;
    return Math.round((c / t) * 10 * 100) / 100;
  }
  function fmt(n) {
    if (n === null || n === undefined) return '';
    return (Math.round(n * 100) / 100).toString().replace('.', ',');
  }
  function gradeClass(n) {
    if (n === null) return '';
    if (n >= 8) return 'good';
    if (n >= 6.5) return 'ok';
    if (n >= 5) return 'mid';
    return 'bad';
  }
  function getCell(sh, stId, sid, key) {
    return sh.data[stId] && sh.data[stId][sid] ? sh.data[stId][sid][key] : undefined;
  }
  function getTotal(sh, sid, key) { return sh.totals[sid] ? sh.totals[sid][key] : undefined; }
  /** Các cột hiển thị trong một buổi (cột có thể chỉ áp dụng / bị xoá ở một số buổi) */
  function colsFor(sh, sid) {
    return sh.cols.filter(c => (!c.only || c.only.includes(sid)) && !(c.skip || []).includes(sid));
  }
  function isMark(c) { return c.type === 'attend' || c.type === 'check'; }
  function attendCol(sh) { return sh.cols.find(c => c.type === 'attend'); }
  function isPresent(v) { return v === true || v === 'v'; }
  function isAbsent(v) { return v === 'x'; }
  function sessionAbsent(sh, stId, sid) {
    return colsFor(sh, sid).some(c => c.type === 'attend' && isAbsent(getCell(sh, stId, sid, c.key)));
  }
  function attendance(sh, stId) {
    const col = attendCol(sh);
    if (!col) return null;
    return sh.sessions.filter(s => isPresent(getCell(sh, stId, s.id, col.key))).length;
  }
  function absences(sh, stId) {
    return sh.sessions.filter(s => sessionAbsent(sh, stId, s.id)).length;
  }
  function studentAvg(sh, stId) {
    let sum = 0, cnt = 0;
    sh.sessions.forEach(s => colsFor(sh, s.id).forEach(c => {
      if (c.type !== 'score') return;
      const v = toTen(getCell(sh, stId, s.id, c.key), getTotal(sh, s.id, c.key));
      if (v !== null) { sum += v; cnt++; }
    }));
    return cnt ? sum / cnt : null;
  }
  // ---------- Thống kê: tỷ lệ làm BTVN, tỷ lệ đạt từ mới / kiến thức trọng tâm ----------
  const PASS_SCORE = 5;
  const STAT_DEFS = [
    { key: 'btvn', title: 'Tỷ lệ làm BTVN', short: 'BTVN', test: c => c.type === 'check' && /btvn|bài tập về nhà/i.test(c.label) },
    { key: 'tumoi', title: 'Tỷ lệ đạt từ mới', short: 'Từ mới', test: c => c.type === 'score' && /từ mới|từ vựng/i.test(c.label) },
    { key: 'kttt', title: 'Tỷ lệ đạt trọng tâm', short: 'Trọng tâm', test: c => c.type === 'score' && /trọng tâm/i.test(c.label) },
  ];
  function statColsOf(sh) {
    return STAT_DEFS.map(d => ({ def: d, col: sh.cols.find(d.test) })).filter(x => x.col);
  }
  /** {ok, total}: BTVN = số buổi ✓ / số buổi đã chấm ✓ hoặc ✗; điểm = số bài ≥ 5 / số bài có điểm */
  function statOf(sh, stId, def, col) {
    let ok = 0, total = 0;
    sh.sessions.forEach(s => {
      if (!colsFor(sh, s.id).includes(col)) return;
      const v = getCell(sh, stId, s.id, col.key);
      if (def.key === 'btvn') {
        if (isPresent(v)) { ok++; total++; } else if (isAbsent(v)) total++;
      } else {
        const sc = toTen(v, getTotal(sh, s.id, col.key));
        if (sc !== null) { total++; if (sc >= PASS_SCORE) ok++; }
      }
    });
    return { ok, total };
  }
  function pctHTML(st) {
    if (!st.total) return '<span class="muted">–</span>';
    const p = Math.round(st.ok / st.total * 100);
    const cls = p >= 80 ? 'good' : p >= 50 ? 'mid' : 'bad';
    return `<span class="pct ${cls}">${p}%</span><span class="frac">${st.ok}/${st.total}</span>`;
  }

  function convInfo(correct, total) {
    const c = num(correct);
    if (c === null) return { text: '', cls: '' };
    const t = num(total);
    if (t === null || t <= 0) return { text: 'thiếu tổng', cls: 'warn' };
    const v = toTen(c, t);
    return { text: fmt(v) + '/10', cls: gradeClass(v) };
  }

  /** Màu ô điểm.
   *  Sheet có điểm mục tiêu (khảo sát): ≥ mục tiêu xanh, < 5 đỏ, còn lại giữ nguyên.
   *  Sheet khác: ≥ 5 xanh, < 5 đỏ. */
  function targetClass(sh, stId, score, col) {
    if (score === null || score === undefined) return '';
    if (!sh.targets) return score >= 5 ? 'tgt-hit' : 'tgt-low';
    const tg = num(sh.targets[stId]);
    if (tg !== null && score >= tg && !(col && col.noTarget)) return 'tgt-hit';
    if (score < 5) return 'tgt-low';
    return '';
  }
  /** Nội dung hiển thị trong ô điểm khi không gõ: điểm /10 (hoặc số câu đúng nếu chưa có tổng) */
  function scoreDisplay(v, t) {
    const sc = toTen(v, t);
    if (sc !== null) return fmt(sc);
    return num(v) === null ? '' : fmt(num(v));
  }
  function scoreTitle(v, t, label) {
    const c = num(v), tt = num(t);
    if (c === null) return `${label}: nhập số câu đúng`;
    if (tt === null || tt <= 0) return `${label}: ${fmt(c)} câu đúng – chưa nhập tổng số câu`;
    return `${label}: ${fmt(c)}/${fmt(tt)} câu đúng = ${fmt(toTen(c, tt))} điểm`;
  }

  // ---------- Helpers ----------
  const $ = sel => document.querySelector(sel);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function className(cid) {
    const c = CLASSES.find(x => x.id === cid) || TRASH.find(x => x.id === cid);
    if (!c) return 'Lớp';
    return c.group ? 'Lớp ' + c.name : c.name;
  }
  function sessionLabel(sh, sid) {
    const i = sh.sessions.findIndex(s => s.id === sid);
    return (sh.sessions[i] && sh.sessions[i].name) || 'Buổi ' + (i + 1);
  }
  function hueOf(sh, sid) {
    const i = sh.sessions.findIndex(s => s.id === sid);
    return SESSION_HUES[(i < 0 ? 0 : i) % SESSION_HUES.length];
  }
  function visibleSessions(sh) {
    if (ui.session !== 'all') {
      const s = sh.sessions.find(x => x.id === String(ui.session));
      if (s) return [s];
      ui.session = 'all';
    }
    return sh.sessions;
  }

  // ---------- Font ----------
  function applyFont() {
    const f = FONTS.find(x => x.name === ui.font) || FONTS[0];
    document.documentElement.style.setProperty('--font', f.css);
    document.documentElement.style.setProperty('--fs', (Number(ui.size) || 14) + 'px');
  }
  function renderFontControls() {
    $('#fontSel').innerHTML = FONTS.map(f => `<option value="${esc(f.name)}" style="font-family:${esc(f.css)}">${esc(f.name)}</option>`).join('');
    $('#fontSel').value = ui.font;
    $('#sizeSel').innerHTML = SIZES.map(s => `<option value="${s}">${s}px</option>`).join('');
    $('#sizeSel').value = String(ui.size);
  }

  // ---------- Render ----------
  function renderClassTabs() {
    let html = '';
    let i = 0;
    while (i < CLASSES.length) {
      const c = CLASSES[i];
      if (c.group) {
        const g = c.group;
        html += `<div class="group"><span class="group-label">${esc(g)}</span>`;
        while (i < CLASSES.length && CLASSES[i].group === g) {
          const x = CLASSES[i];
          html += `<button data-cls="${esc(x.id)}" class="${x.id === ui.cls ? 'active' : ''}">${esc(x.name)} <span class="cnt" data-cnt="${esc(x.id)}"></span></button>`;
          i++;
        }
        html += '</div>';
      } else {
        html += `<button data-cls="${esc(c.id)}" class="${c.id === ui.cls ? 'active' : ''}">${esc(c.name)} <span class="cnt" data-cnt="${esc(c.id)}"></span></button>`;
        i++;
      }
    }
    html += `<button class="cls-manage" id="manageClasses" title="Thêm, đổi tên, xoá hoặc khôi phục lớp">⚙ Lớp</button>`;
    $('#classTabs').innerHTML = html;
    updateCounts();
  }

  /** Sĩ số từng lớp: số trên nút lớp + dòng tổng */
  function updateCounts() {
    let all = 0;
    CLASSES.forEach(c => {
      const n = classData(c.id).students.length;
      all += n;
      const el = document.querySelector(`[data-cnt="${CSS.escape(c.id)}"]`);
      if (el) el.textContent = n;
    });
    const stat = document.getElementById('classStat');
    if (stat) stat.innerHTML = `${esc(className(ui.cls))}: <b>${classData(ui.cls).students.length}</b> học sinh · Tất cả các lớp: <b>${all}</b> học sinh`;
  }

  function renderSheetTabs() {
    validSheet();
    const inScore = isClassScore(ui.sheet);
    $('#sheetTabs').innerHTML = SHEETS.map(s => {
      const act = (s.id === 'trenlop' ? inScore : s.id === ui.sheet) ? 'active' : '';
      return `<button data-sheet="${s.id}" class="${act}">${esc(s.name)}</button>`;
    }).join('');
    // Hàng tháng (bên dưới): chỉ hiện khi đang ở "Điểm trên lớp"
    const row = $('#monthTabs');
    if (!inScore) { row.hidden = true; row.innerHTML = ''; return; }
    row.hidden = false;
    row.innerHTML = '<span class="mt-label">📅 Tháng:</span>' + scoreSheetsOf(ui.cls).map(m => {
      const act = m.id === ui.sheet ? 'active' : '';
      const x = m.id === 'trenlop' ? '' : `<span class="tab-x" data-delmonth="${esc(m.id)}" title="Xoá sheet ${esc(m.name)}">×</span>`;
      return `<button data-sheet="${esc(m.id)}" class="month-tab ${act}" title="Bấm đúp để đổi tên">${esc(m.name)}${x}</button>`;
    }).join('') + `<button class="add-month" id="addMonth" title="Thêm sheet điểm theo tháng cho ${esc(className(ui.cls))}">+ Thêm tháng</button>`;
  }

  function renderToolbar() {
    validSheet();
    const def = sheetDef(ui.sheet);
    let html = '';
    if (def.type === 'sessions') {
      const sh = sheetData(ui.cls, ui.sheet);
      html += `<input type="text" id="newStudent" placeholder="Nhập họ tên học sinh rồi Enter">
        <button class="btn primary" id="addStudent">+ Thêm HS</button>
        <button class="btn" id="bulkAdd">Dán danh sách</button>
        <button class="btn" id="sortNames" title="Sắp xếp theo tên (chữ cuối của họ tên), ví dụ “Thu An” xếp theo “An”">↕ Sắp xếp A→Z</button>
        <button class="btn soft" id="addCol">+ Thêm cột</button>
        <button class="btn soft" id="delCol">− Xoá cột</button>
        <button class="btn soft" id="addSession">+ Thêm buổi</button>
        <select id="sessionFilter" title="Lọc buổi">
          <option value="all">Hiện tất cả ${sh.sessions.length} buổi</option>
          ${sh.sessions.map(s => `<option value="${esc(s.id)}">Chỉ ${esc(sessionLabel(sh, s.id))}</option>`).join('')}
        </select>`;
    } else if (def.type === 'review') {
      const ks = sheetData(ui.cls, 'khaosat');
      const cur = reviewMonth();
      html += `<label class="rv-month">Tháng khảo sát
          <select id="reviewMonth">${ks.sessions.map(s => `<option value="${esc(s.id)}" ${s.id === cur ? 'selected' : ''}>${esc(sessionLabel(ks, s.id))}</option>`).join('')}</select>
        </label>
        <button class="btn primary" id="copyAllReviews">📋 Sao chép tất cả nhận xét</button>
        <button class="btn" id="regenAllReviews" title="Bỏ các chỗ đã sửa tay, viết lại toàn bộ nhận xét của tháng này">↺ Viết lại tất cả</button>`;
    } else {
      html += `<button class="btn primary" id="addPlan">+ Thêm dòng kế hoạch</button>`;
    }
    html += `<span class="undo-group"><button class="btn" id="undoBtn" disabled>↶ Hoàn tác</button><button class="btn" id="redoBtn" disabled>↷ Làm lại</button></span>
      <span class="spacer"></span>
      <button class="btn" id="exportCsv">Xuất Excel (CSV)</button>
      <button class="btn" id="printBtn">In</button>
      <button class="btn" id="backupBtn" title="Lấy toàn bộ dữ liệu (chép hoặc tải file)">Sao lưu</button>
      <button class="btn" id="restoreBtn" title="Dán hoặc chọn file sao lưu">Khôi phục</button>`;
    $('#toolbar').innerHTML = html;
    updateUndoButtons();
    if (def.type === 'sessions') $('#sessionFilter').value = String(ui.session);

    if (def.type === 'review') {
      $('#hint').innerHTML = `Bảng lấy <b>điểm khảo sát</b> của tháng đã chọn. Cô ghi ngắn ở cột <b>Điểm mạnh</b> / <b>Điểm cần cải thiện</b> (mỗi ý một dòng hoặc cách nhau bằng dấu chấm phẩy, ví dụ: <i>đọc kỹ đề; lỗi nhỏ khi viết lại câu</i>) → nhận xét bên dưới tự viết thành câu và kèm gợi ý. Để trống thì web tự nhận xét dựa trên điểm. Web tự thêm nhận xét về <b>làm BTVN</b> và <b>học từ mới</b> theo tỷ lệ ở sheet điểm trên lớp cùng tháng (BTVN ≥ 90%: chăm chỉ; 60–90%: cần thường xuyên hơn; dưới 60%: cần chăm chỉ hơn — từ mới: ≥ 80% / 50–80% / dưới 50%). Có thể sửa tay từng nhận xét; bấm <b>↺ Viết lại</b> để quay về bản tự động.`;
      return;
    }
    $('#hint').innerHTML = def.type === 'sessions'
      ? `Hàng <b>“Tổng số câu”</b>: nhập tổng số câu của bài. Ô điểm: nhập <b>số câu đúng</b> → khi rời ô sẽ tự hiện <b>điểm /10</b> (bấm lại vào ô để xem/sửa số câu đúng).
         Điểm danh, BTVN, chép nghe, chép phạt: bấm 1 lần = <b>✓</b>, 2 lần = <b>✗</b>, 3 lần = xoá. Vắng (✗ điểm danh) thì chỉ các ô của buổi đó bôi đỏ. Nút <b>↕ Sắp xếp A→Z</b> xếp theo tên (chữ cuối của họ tên). Dùng phím <b>← → ↑ ↓</b> để di chuyển giữa các ô, <b>Enter</b> để xuống ô dưới. <b>Ctrl+Z</b> hoàn tác, <b>Ctrl+Y</b> làm lại. Đổi chỗ cột: kéo thả tiêu đề cột hoặc bấm <b>‹ ›</b>. Cuối mỗi dòng: <b>tỷ lệ làm BTVN</b> (số buổi ✓ / số buổi đã chấm) và <b>tỷ lệ đạt</b> từ mới, trọng tâm (số bài từ 5 điểm / số bài có điểm).
         ${def.target ? 'Cột <b>Điểm mục tiêu</b>: ô điểm <b>≥ mục tiêu</b> bôi xanh, <b>dưới 5</b> bôi đỏ, còn lại giữ nguyên.' : 'Điểm <b>từ 5 trở lên</b> bôi xanh, <b>dưới 5</b> bôi đỏ.'}
         <span class="legend"><span class="hit">${def.target ? 'đạt mục tiêu' : '≥ 5'}</span><span class="low">dưới 5</span><span class="abs">vắng</span></span>`
      : 'Lập kế hoạch học IELTS cho ' + esc(className(ui.cls)) + '. Dữ liệu tự lưu trên trình duyệt này.';
  }

  function renderContent() {
    const wrap = $('#content');
    const sl = wrap.scrollLeft, st = wrap.scrollTop;
    updateCounts();
    validSheet();
    const type = sheetDef(ui.sheet).type;
    if (type === 'sessions') renderSessions();
    else if (type === 'review') renderReview();
    else renderPlan();
    wrap.scrollLeft = sl;
    wrap.scrollTop = st;
  }

  function cellHTML(sh, stId, sid, c, extraCls, style) {
    const v = getCell(sh, stId, sid, c.key);
    const ref = `${sid}|${c.key}`;
    const title = `${esc(c.label)} – ${esc(sessionLabel(sh, sid))}`;
    if (isMark(c)) {
      const cls = isPresent(v) ? 'present' : isAbsent(v) ? 'absent' : '';
      const txt = isPresent(v) ? '✓' : isAbsent(v) ? '✗' : '';
      const tint = c.type === 'check' ? (isPresent(v) ? 'mark-yes' : isAbsent(v) ? 'mark-no' : '') : '';
      return `<td class="chk ${extraCls} ${tint}" ${style}><button class="att-btn ${cls}" data-attcell="${ref}" title="${title}: bấm để đổi ✓ / ✗">${txt}</button></td>`;
    }
    if (c.type === 'text') {
      return `<td class="text ${extraCls}" ${style}><input type="text" data-cell="${ref}" value="${esc(v ?? '')}" title="${title}"></td>`;
    }
    const t = getTotal(sh, sid, c.key);
    const over = num(v) !== null && num(t) !== null && num(v) > num(t);
    const noTotal = num(v) !== null && (num(t) === null || num(t) <= 0);
    const tc = targetClass(sh, stId, toTen(v, t), c);
    return `<td class="score ${extraCls} ${tc}" ${style}><input type="text" inputmode="decimal" class="score-in ${over ? 'over' : ''} ${noTotal ? 'nototal' : ''}" data-cell="${ref}" data-kind="score" value="${esc(scoreDisplay(v, t))}" placeholder="–" title="${esc(scoreTitle(v, t, c.label + ' – ' + sessionLabel(sh, sid)))}"></td>`;
  }

  function renderSessions() {
    const sh = sheetData(ui.cls, ui.sheet);
    const students = classData(ui.cls).students;
    const sessions = visibleSessions(sh);
    const hasAttend = !!attendCol(sh);
    const st = s => `style="--h:${hueOf(sh, s.id)}"`;
    const hasTarget = !!sheetDef(ui.sheet).target;
    const lead = hasTarget ? 3 : 2;
    const cf = {};
    sessions.forEach(s => { cf[s.id] = colsFor(sh, s.id); });
    const width = sessions.reduce((a, s) => a + Math.max(cf[s.id].length, 1), 0);
    const defNow = sheetDef(ui.sheet);
    const notes = defNow.type === 'sessions' && !defNow.target ? ((CLASSES.find(c => c.id === ui.cls) || {}).notes || []) : [];

    let h = `<h2 class="print-title">${esc(className(ui.cls))} – ${esc(sheetTitle(ui.cls, ui.sheet))}</h2>`;
    h += '<table class="grid"><thead><tr>';
    h += '<th rowspan="2" class="sticky c-stt">STT</th><th rowspan="2" class="sticky c-name">Họ và tên</th>';
    if (hasTarget) h += '<th rowspan="2" class="sticky c-target">Điểm<br>mục tiêu<br>(/10)</th>';
    sessions.forEach(s => {
      h += `<th colspan="${Math.max(cf[s.id].length, 1)}" class="sh sess-start" ${st(s)}><span class="sess-lbl" data-rensess="${esc(s.id)}" title="Bấm đúp để đổi tên (VD: Tháng 11)">${esc(sessionLabel(sh, s.id))}</span> <button class="sess-del" data-delsess="${esc(s.id)}" title="Xoá ${esc(sessionLabel(sh, s.id))}">×</button>${s.name ? '' : `<div><input type="date" class="sdate" data-sdate="${esc(s.id)}" value="${esc(s.date || '')}" title="Ngày học"></div>`}</th>`;
    });
    const stats = isClassScore(ui.sheet) ? statColsOf(sh) : [];
    h += '<th rowspan="3" class="sess-start">Tổng số<br>buổi đi học</th><th rowspan="3">Số buổi<br>vắng</th><th rowspan="3">Điểm TB<br>(/10)</th>';
    stats.forEach((x, i) => { h += `<th rowspan="3" class="stat-h ${i === 0 ? 'sess-start' : ''}" title="${x.def.key === 'btvn' ? 'Số buổi ✓ / số buổi đã chấm ✓ hoặc ✗' : 'Số bài đạt từ 5 điểm / số bài có điểm'}">${esc(x.def.title).replace('Tỷ lệ ', 'Tỷ lệ<br>')}</th>`; });
    h += '<th rowspan="3"></th></tr><tr>';
    sessions.forEach(s => {
      if (!cf[s.id].length) { h += `<th class="sub ss sess-start" ${st(s)}>(chưa có cột)</th>`; return; }
      cf[s.id].forEach((c, i) => {
        const n = cf[s.id].length;
        h += `<th class="sub ss ${i === 0 ? 'sess-start' : ''}" ${st(s)} draggable="true" data-dragcol="${esc(c.key)}" data-dragsess="${esc(s.id)}" title="Kéo để đổi chỗ cột · bấm đúp tên để đổi tên"><span class="lbl" data-rencol="${esc(c.key)}">${esc(c.label)}</span><span class="col-tools"><button class="col-move" data-colmove="${esc(c.key)}" data-colmovesess="${esc(s.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Dời cột sang trái">‹</button><button class="col-del" data-delcol="${esc(c.key)}" data-delcolsess="${esc(s.id)}" title="Xoá cột “${esc(c.label)}”">×</button><button class="col-move" data-colmove="${esc(c.key)}" data-colmovesess="${esc(s.id)}" data-dir="1" ${i === n - 1 ? 'disabled' : ''} title="Dời cột sang phải">›</button></span></th>`;
      });
    });
    h += `</tr><tr class="totals-row"><th colspan="${lead}" class="sticky c-stt" style="text-align:right">Tổng số câu →</th>`;
    sessions.forEach(s => {
      if (!cf[s.id].length) { h += `<th class="sc sess-start" ${st(s)}></th>`; return; }
      cf[s.id].forEach((c, i) => {
        const cls = `sc ${i === 0 ? 'sess-start' : ''}`;
        if (c.type === 'score') {
          const t = getTotal(sh, s.id, c.key);
          h += `<th class="${cls}" ${st(s)}><input type="text" inputmode="decimal" class="total" data-total="${esc(s.id)}|${esc(c.key)}" value="${esc(t ?? '')}" placeholder="tổng" title="Tổng số câu – ${esc(c.label)} – ${esc(sessionLabel(sh, s.id))}"></th>`;
        } else h += `<th class="${cls}" ${st(s)}></th>`;
      });
    });
    h += '</tr></thead><tbody>';

    if (!students.length) {
      h += `<tr><td class="empty" colspan="${lead + width + 4 + stats.length}">Chưa có học sinh. Hãy thêm học sinh ở thanh công cụ phía trên.</td></tr>`;
    }

    students.forEach((stu, idx) => {
      h += `<tr data-st="${stu.id}"><td class="sticky c-stt">${idx + 1}</td>`;
      h += `<td class="sticky c-name"><input class="name" data-name="${stu.id}" value="${esc(stu.name)}"></td>`;
      if (hasTarget) h += `<td class="sticky c-target"><input type="text" inputmode="decimal" class="target" data-target="${stu.id}" value="${esc(sh.targets[stu.id] ?? '')}" placeholder="—" title="Điểm mục tiêu (/10)"></td>`;
      sessions.forEach(s => {
        const abs = sessionAbsent(sh, stu.id, s.id) ? 'absent' : '';
        if (!cf[s.id].length) { h += `<td class="sc sess-start ${abs}" ${st(s)}></td>`; return; }
        cf[s.id].forEach((c, i) => { h += cellHTML(sh, stu.id, s.id, c, `sc ${i === 0 ? 'sess-start' : ''} ${abs}`, st(s)); });
      });
      const avg = studentAvg(sh, stu.id);
      const att = attendance(sh, stu.id);
      h += `<td class="att sess-start" data-att>${hasAttend ? `${att}/${sh.sessions.length}` : '—'}</td>`;
      h += `<td class="att" style="color:var(--bad)">${absences(sh, stu.id) || ''}</td>`;
      h += `<td class="avg" data-avg><span class="conv ${gradeClass(avg)}">${fmt(avg)}</span></td>`;
      stats.forEach((x, i) => { h += `<td class="stat ${i === 0 ? 'sess-start' : ''}" data-stat="${x.def.key}">${pctHTML(statOf(sh, stu.id, x.def, x.col))}</td>`; });
      h += `<td><button class="del" data-del="${stu.id}" title="Xoá học sinh">×</button></td></tr>`;
    });

    // Dòng ghi chú theo buổi (lớp IELTS)
    notes.forEach(nt => {
      h += `<tr class="note-row"><td colspan="${lead}" class="sticky c-stt note-lbl">${esc(nt.label)}</td>`;
      sessions.forEach(s => {
        const val = sh.notes && sh.notes[s.id] ? sh.notes[s.id][nt.key] : '';
        h += `<td colspan="${Math.max(cf[s.id].length, 1)}" class="sc sess-start note-cell" ${st(s)}><textarea data-note="${esc(s.id)}|${esc(nt.key)}" rows="3" placeholder="${esc(nt.label)} – ${esc(sessionLabel(sh, s.id))}">${esc(val || '')}</textarea></td>`;
      });
      h += `<td colspan="${4 + stats.length}" class="sess-start"></td></tr>`;
    });
    h += '</tbody>';

    if (students.length) {
      h += `<tfoot><tr><td colspan="${lead}" class="sticky c-stt" style="text-align:right">TB lớp / Có mặt</td>`;
      sessions.forEach(s => {
        if (!cf[s.id].length) { h += `<td class="sc sess-start" ${st(s)}></td>`; return; }
        cf[s.id].forEach((c, i) => {
          h += `<td class="sc ${i === 0 ? 'sess-start' : ''}" ${st(s)} data-foot="${esc(s.id)}|${esc(c.key)}"></td>`;
        });
      });
      h += '<td class="sess-start" data-foot="att"></td><td></td><td data-foot="avg"></td>';
      stats.forEach((x, i) => { h += `<td class="stat ${i === 0 ? 'sess-start' : ''}" data-foot="stat:${x.def.key}"></td>`; });
      h += '<td></td></tr></tfoot>';
    }
    h += '</table>';
    $('#content').innerHTML = h;
    updateFooter();
    fixHeader();
  }

  // Cố định 3 hàng tiêu đề khi cuộn dọc
  const headObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fixHeader()) : null;
  function fixHeader() {
    const thead = document.querySelector('#content thead');
    if (headObserver && thead && !thead.dataset.observed) {
      thead.dataset.observed = '1';
      headObserver.disconnect();
      thead.querySelectorAll('tr').forEach(tr => headObserver.observe(tr));
    }
    // Cột cố định bên trái: đo độ rộng thật để cột điểm mục tiêu luôn nằm sát cột tên
    const table = document.querySelector('#content table.grid');
    const stt = document.querySelector('#content thead th.c-stt');
    const name = document.querySelector('#content thead th.c-name');
    if (table && stt && name) {
      table.style.setProperty('--left-name', stt.getBoundingClientRect().width + 'px');
      table.style.setProperty('--left-target', (stt.getBoundingClientRect().width + name.getBoundingClientRect().width) + 'px');
    }
    let top = 0;
    document.querySelectorAll('#content thead tr').forEach(tr => {
      tr.querySelectorAll('th').forEach(th => { if (th.rowSpan === 1 || top === 0) th.style.top = top + 'px'; });
      top += tr.getBoundingClientRect().height;
    });
  }

  function updateFooter() {
    const sh = sheetData(ui.cls, ui.sheet);
    const students = classData(ui.cls).students;
    document.querySelectorAll('#content [data-foot]').forEach(td => {
      const f = td.dataset.foot;
      if (f === 'att') {
        const vals = students.map(st => attendance(sh, st.id)).filter(v => v !== null);
        td.textContent = vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length) + ' buổi' : '';
        return;
      }
      if (f.startsWith('stat:')) {
        const x = statColsOf(sh).find(y => y.def.key === f.slice(5));
        if (!x) return;
        const sum = students.reduce((a, st) => { const r = statOf(sh, st.id, x.def, x.col); a.ok += r.ok; a.total += r.total; return a; }, { ok: 0, total: 0 });
        td.innerHTML = pctHTML(sum);
        return;
      }
      if (f === 'avg') {
        const avgs = students.map(st => studentAvg(sh, st.id)).filter(v => v !== null);
        const a = avgs.length ? avgs.reduce((x, y) => x + y, 0) / avgs.length : null;
        td.innerHTML = `<span class="conv ${gradeClass(a)}">${fmt(a)}</span>`;
        return;
      }
      const [sid, key] = f.split('|');
      const col = sh.cols.find(c => c.key === key);
      if (!col) return;
      if (col.type === 'attend') {
        const cnt = students.filter(st => isPresent(getCell(sh, st.id, sid, key))).length;
        const abs = students.filter(st => isAbsent(getCell(sh, st.id, sid, key))).length;
        td.innerHTML = (cnt || abs) ? `${cnt}/${students.length}${abs ? ` <span style="color:var(--bad)">✗${abs}</span>` : ''}` : '';
      } else if (col.type === 'check') {
        const yes = students.filter(st => isPresent(getCell(sh, st.id, sid, key))).length;
        const no = students.filter(st => isAbsent(getCell(sh, st.id, sid, key))).length;
        td.innerHTML = (yes || no) ? `✓${yes}${no ? ` <span style="color:var(--bad)">✗${no}</span>` : ''}` : '';
      } else if (col.type === 'score') {
        const vals = students.map(st => toTen(getCell(sh, st.id, sid, key), getTotal(sh, sid, key))).filter(v => v !== null);
        const a = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
        td.innerHTML = `<span class="conv ${gradeClass(a)}">${fmt(a)}</span>`;
      }
    });
  }

  function updateRow(tr) {
    const sh = sheetData(ui.cls, ui.sheet);
    const stId = tr.dataset.st;
    const avg = studentAvg(sh, stId);
    const att = attendance(sh, stId);
    tr.querySelector('[data-att]').textContent = att === null ? '—' : `${att}/${sh.sessions.length}`;
    tr.querySelector('[data-avg]').innerHTML = `<span class="conv ${gradeClass(avg)}">${fmt(avg)}</span>`;
    tr.querySelectorAll('[data-stat]').forEach(td => {
      const x = statColsOf(sh).find(y => y.def.key === td.dataset.stat);
      if (x) td.innerHTML = pctHTML(statOf(sh, stId, x.def, x.col));
    });
  }

  function updateScoreCell(tr, sid, key) {
    // ô đã bị vẽ lại / đã chuyển sang sheet khác thì bỏ qua
    if (!tr || !tr.isConnected || sheetDef(ui.sheet).type !== 'sessions') return;
    const sh = sheetData(ui.cls, ui.sheet);
    const v = getCell(sh, tr.dataset.st, sid, key);
    const t = getTotal(sh, sid, key);
    const input = tr.querySelector(`input[data-cell="${CSS.escape(sid + '|' + key)}"]`);
    if (!input) return;
    const col = sh.cols.find(c => c.key === key);
    if (document.activeElement !== input) input.value = scoreDisplay(v, t);
    input.title = scoreTitle(v, t, (col ? col.label : '') + ' – ' + sessionLabel(sh, sid));
    input.classList.toggle('over', num(v) !== null && num(t) !== null && num(v) > num(t));
    input.classList.toggle('nototal', num(v) !== null && (num(t) === null || num(t) <= 0));
    const td = input.closest('td');
    td.classList.remove('tgt-hit', 'tgt-low');
    const tc = targetClass(sh, tr.dataset.st, toTen(v, t), col);
    if (tc) td.classList.add(tc);
  }

  function renderPlan() {
    const sh = sheetData(ui.cls, ui.sheet);
    let h = `<h2 class="print-title">${esc(className(ui.cls))} – Kế hoạch IELTS</h2>`;
    h += `<table class="grid plan"><thead><tr>
      <th class="w-week">STT / Tuần</th><th class="w-date">Ngày</th><th class="w-skill">Kỹ năng</th>
      <th class="w-content">Nội dung bài học</th><th class="w-mat">Tài liệu</th><th class="w-target">Mục tiêu (band)</th>
      <th class="w-done">Hoàn thành</th><th class="w-note">Ghi chú</th><th></th></tr></thead><tbody>`;
    if (!sh.rows.length) h += '<tr><td class="empty" colspan="9">Chưa có kế hoạch. Bấm “+ Thêm dòng kế hoạch”.</td></tr>';
    sh.rows.forEach((r, i) => {
      h += `<tr class="${r.done ? 'done' : ''}" data-row="${i}">
        <td><input data-plan="week" value="${esc(r.week)}"></td>
        <td><input type="date" data-plan="date" value="${esc(r.date)}"></td>
        <td><select data-plan="skill">${SKILLS.map(sk => `<option ${r.skill === sk ? 'selected' : ''}>${sk}</option>`).join('')}</select></td>
        <td><textarea data-plan="content" rows="1">${esc(r.content)}</textarea></td>
        <td><textarea data-plan="material" rows="1">${esc(r.material)}</textarea></td>
        <td><input data-plan="target" value="${esc(r.target)}"></td>
        <td class="chk"><input type="checkbox" data-plan="done" ${r.done ? 'checked' : ''}></td>
        <td><textarea data-plan="note" rows="1">${esc(r.note)}</textarea></td>
        <td><button class="del" data-delrow="${i}" title="Xoá dòng">×</button></td></tr>`;
    });
    h += '</tbody></table>';
    $('#content').innerHTML = h;
  }

  function renderAll() {
    applyFont();
    renderClassTabs();
    renderSheetTabs();
    renderToolbar();
    renderContent();
  }

  /** Vẽ lại khi người khác sửa, giữ nguyên ô đang nhập của mình */
  const FOCUS_ATTRS = ['data-cell', 'data-total', 'data-name', 'data-target', 'data-plan', 'data-attcell', 'data-sdate', 'data-note', 'data-rv', 'data-rvtext'];
  function renderKeepFocus() {
    const a = document.activeElement;
    let keep = null;
    if (a && $('#content').contains(a)) {
      const attr = FOCUS_ATTRS.find(x => a.hasAttribute(x));
      const tr = a.closest('tr');
      if (attr) {
        keep = { attr, val: a.getAttribute(attr), st: tr && tr.dataset.st, row: tr && tr.dataset.row, value: a.value, type: a.type };
        try { keep.s = a.selectionStart; keep.e = a.selectionEnd; } catch (e) { /* number input */ }
      }
    }
    const sh = sheetData(ui.cls, ui.sheet);
    const sessCount = $('#sessionFilter') ? $('#sessionFilter').options.length : -1;
    if (sh.sessions && sessCount !== sh.sessions.length + 1 && !$('#toolbar').contains(a)) renderToolbar();
    renderContent();
    if (!keep) return;
    let scope = '#content ';
    if (keep.st) scope += `tr[data-st="${CSS.escape(keep.st)}"] `;
    else if (keep.row !== undefined) scope += `tr[data-row="${CSS.escape(keep.row)}"] `;
    const el = document.querySelector(`${scope}[${keep.attr}="${CSS.escape(keep.val)}"]`);
    if (!el) return;
    el.focus();
    if (keep.type !== 'checkbox' && el.tagName !== 'BUTTON' && el.tagName !== 'SELECT' && el.value !== keep.value) el.value = keep.value;
    if (keep.s != null) { try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* ignore */ } }
  }

  // ---------- Sheet theo tháng ----------
  function nextMonthName(cid) {
    const ms = scoreSheetsOf(cid);
    const last = ms[ms.length - 1].name;
    const m = /(\d+)\s*$/.exec(last);
    const n = m ? (Number(m[1]) % 12) + 1 : new Date().getMonth() + 1;
    return 'Tháng ' + n;
  }
  function addMonth() {
    const c = CLASSES.find(x => x.id === ui.cls);
    if (!c) return;
    const name = prompt(`Tên sheet tháng mới cho ${className(ui.cls)}:`, nextMonthName(ui.cls));
    if (!name || !name.trim()) return;
    if (scoreSheetsOf(ui.cls).some(m => m.name.trim().toLowerCase() === name.trim().toLowerCase()) &&
        !confirm(`${className(ui.cls)} đã có sheet “${name.trim()}”. Vẫn tạo thêm sheet trùng tên?`)) return;
    const id = 'mon_' + uid();
    // lấy sẵn bộ cột của tháng gần nhất (hoặc sheet Điểm trên lớp), không lấy điểm
    const ms = c.months || [];
    const src = sheetData(ui.cls, ms.length ? ms[ms.length - 1].id : 'trenlop');
    c.months = [...ms, { id, name: name.trim() }];
    const sh = classData(ui.cls).sheets[id] = {
      sessions: Array.from({ length: DEFAULT_SESSIONS }, (_, i) => ({ id: String(i + 1) })),
      cols: src.cols.map(col => { const x = Object.assign({}, col); delete x.only; delete x.skip; return x; }),
      totals: {}, data: {},
    };
    sync(COL_SHEETS, sheetDocId(ui.cls, id), ['cols'], sh.cols);
    sync(COL_SHEETS, sheetDocId(ui.cls, id), ['sessions'], sh.sessions);
    ui.sheet = id; ui.session = 'all'; saveUI();
    saveConfig();
    renderSheetTabs(); renderToolbar(); renderContent();
  }
  function renameMonth(mid) {
    if (mid === 'trenlop') {
      const c = CLASSES.find(x => x.id === ui.cls);
      if (!c) return;
      const name = prompt('Tên tháng của sheet này:', baseMonthName(ui.cls));
      if (!name || !name.trim()) return;
      c.baseMonth = name.trim();
      saveConfig();
      renderSheetTabs(); renderContent();
      return;
    }
    const c = CLASSES.find(x => (x.months || []).some(m => m.id === mid));
    if (!c) return;
    const m = c.months.find(x => x.id === mid);
    const name = prompt('Tên mới cho sheet:', m.name);
    if (!name || !name.trim()) return;
    c.months = c.months.map(x => x.id === mid ? Object.assign({}, x, { name: name.trim() }) : x);
    saveConfig();
    renderSheetTabs(); renderToolbar(); renderContent();
  }
  function deleteMonth(mid) {
    const c = CLASSES.find(x => (x.months || []).some(m => m.id === mid));
    if (!c) return;
    const m = c.months.find(x => x.id === mid);
    if (!confirm(`Xoá sheet “${m.name}” của ${className(c.id)}?\n\nĐiểm trong sheet vẫn được giữ: có thể bấm Hoàn tác (Ctrl+Z) hoặc khôi phục trong ⚙ Lớp → “Tháng đã xoá”.`)) return;
    const pos = c.months.findIndex(x => x.id === mid);
    c.months = c.months.filter(x => x.id !== mid);
    c.monthsTrash = [Object.assign({}, m, { deletedAt: Date.now(), pos }), ...(c.monthsTrash || [])];
    if (ui.sheet === mid) { ui.sheet = 'trenlop'; ui.session = 'all'; saveUI(); }
    saveConfig();
    renderSheetTabs(); renderToolbar(); renderContent();
    if ($('#classDialog').open) renderClassManager();
  }
  function restoreMonth(cid, mid) {
    const c = CLASSES.find(x => x.id === cid);
    if (!c) return;
    const m = (c.monthsTrash || []).find(x => x.id === mid);
    if (!m) return;
    c.monthsTrash = c.monthsTrash.filter(x => x.id !== mid);
    const back = { id: m.id, name: m.name };
    const ms = (c.months || []).slice();
    ms.splice(Number.isInteger(m.pos) ? Math.min(m.pos, ms.length) : ms.length, 0, back);
    c.months = ms;
    ui.cls = cid; ui.sheet = mid; ui.session = 'all'; saveUI();
    saveConfig();
    renderClassTabs(); renderSheetTabs(); renderToolbar(); renderContent();
    if ($('#classDialog').open) renderClassManager();
  }

  // ---------- Nhận xét: lấy điểm khảo sát + tự viết nhận xét ----------
  function reviewMonth() {
    const ks = sheetData(ui.cls, 'khaosat');
    const saved = ui.reviewMonths[ui.cls];
    if (saved && ks.sessions.some(s => s.id === saved)) return saved;
    // mặc định: tháng gần nhất có điểm
    const students = classData(ui.cls).students;
    for (let i = ks.sessions.length - 1; i >= 0; i--) {
      const sid = ks.sessions[i].id;
      if (students.some(st => colsFor(ks, sid).some(c => c.type === 'score' && toTen(getCell(ks, st.id, sid, c.key), getTotal(ks, sid, c.key)) !== null))) return sid;
    }
    return ks.sessions.length ? ks.sessions[ks.sessions.length - 1].id : '';
  }
  function shortLabel(label) {
    let t = String(label || '').replace(/^\s*điểm\s+/i, '').trim().toLowerCase();
    if (/bài làm/.test(t)) t = 'bài tập';
    return t;
  }
  function reviewScores(stId, sid) {
    const ks = sheetData(ui.cls, 'khaosat');
    return colsFor(ks, sid).filter(c => c.type === 'score').map(c => ({
      col: c, label: shortLabel(c.label), value: toTen(getCell(ks, stId, sid, c.key), getTotal(ks, sid, c.key)),
    }));
  }
  function avgOf(scores) {
    const v = scores.map(x => x.value).filter(x => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  const dot = n => String(Math.round(n * 100) / 100);
  const dot1 = n => String(Math.round(n * 10) / 10);
  const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;

  // Từ khoá cô ghi → câu nhận xét
  const STRONG_LIB = [
    [/tự tin|mạnh dạn|\bnói\b/, 'nói tiếng Anh tự tin, mạnh dạn'],
    [/phát âm/, 'phát âm chuẩn, rõ ràng'],
    [/ngữ pháp|cấu trúc/, 'nắm vững cấu trúc câu và ngữ pháp'],
    [/\bnghe\b/, 'có kỹ năng nghe tốt'],
    [/đọc/, 'đọc hiểu tốt'],
    [/từ mới|từ vựng/, 'chăm học từ mới, vốn từ vựng tốt'],
    [/btvn|bài tập về nhà|bài về nhà/, 'làm đầy đủ bài tập về nhà'],
    [/viết/, 'viết câu tốt, diễn đạt rõ ý'],
    [/phát biểu|xây dựng bài|tích cực/, 'tích cực phát biểu xây dựng bài'],
    [/tập trung|chú ý/, 'tập trung, chú ý nghe giảng'],
    [/chăm|chịu khó/, 'chăm chỉ, chịu khó'],
    [/tiến bộ/, 'có nhiều tiến bộ rõ rệt'],
    [/cẩn thận/, 'làm bài cẩn thận'],
    [/ngoan|lễ phép/, 'ngoan, lễ phép'],
  ];
  // Từ khoá → [điều cần cải thiện, gợi ý ngắn]
  const WEAK_LIB = [
    [/đọc\s*(kỹ\s*)?đề|đề bài|(^|\s)đề(\s|$)/, 'đọc kỹ đề bài trước khi làm', 'mỗi lần làm bài, con gạch chân từ khóa trong đề rồi đối chiếu lại câu trả lời.'],
    [/lỗi( sai)? nhỏ|cẩn thận|ẩu|sót|lỗi sai/, 'chú ý hơn các lỗi sai nhỏ', 'sau khi làm xong, con đọc lại từng câu thành tiếng để phát hiện lỗi.'],
    [/viết lại câu/, 'luyện thêm dạng viết lại câu', 'mỗi ngày con làm 5 câu viết lại theo các cấu trúc đã học.'],
    [/chính tả/, 'viết đúng chính tả hơn', 'mỗi ngày con chép lại 5 từ hay viết sai và tự kiểm tra.'],
    [/phát âm/, 'luyện phát âm chuẩn hơn', 'mỗi ngày con nghe và nhại lại audio bài học khoảng 10 phút.'],
    [/từ mới|từ vựng/, 'học từ vựng đều đặn hơn', 'mỗi ngày con học 5–10 từ mới bằng flashcard và ôn lại vào cuối tuần.'],
    [/ngữ pháp|cấu trúc|(^|\s)thì(\s|$)/, 'củng cố thêm ngữ pháp đã học', 'con ôn lại công thức và làm thêm 5–10 câu bài tập mỗi ngày.'],
    [/tập trung|mất trật tự|nói chuyện|chú ý|mất tập trung/, 'tập trung hơn trong giờ học', 'con ghi chép ý chính khi cô giảng để giữ sự tập trung.'],
    [/\bnghe\b/, 'luyện thêm kỹ năng nghe', 'mỗi ngày con nghe lại bài trên lớp và đọc theo transcript 10–15 phút.'],
    [/đọc/, 'cải thiện kỹ năng đọc hiểu', 'mỗi ngày con đọc một đoạn văn ngắn và tóm tắt ý chính bằng 1–2 câu.'],
    [/\bnói\b|tự tin|rụt rè|nhút nhát/, 'mạnh dạn, tự tin hơn khi nói', 'mỗi ngày con tập nói 3–5 câu về một chủ đề quen thuộc, bố mẹ có thể làm người nghe.'],
    [/viết/, 'luyện thêm kỹ năng viết', 'mỗi tuần con viết một đoạn ngắn 5–7 câu và nhờ cô chữa.'],
    [/chép phạt/, 'hoàn thành bài chép phạt đúng hạn', 'con làm bài chép ngay buổi tối sau khi được giao.'],
    [/btvn|bài tập về nhà|bài về nhà|bài tập/, 'hoàn thành bài tập về nhà đầy đủ hơn', 'bố mẹ nhắc con làm bài ngay trong ngày được giao.'],
    [/muộn|vắng|nghỉ/, 'đi học đầy đủ, đúng giờ', 'khi phải nghỉ, con xin bài và làm bù trong tuần.'],
  ];
  const DEFAULT_TIP = 'con dành 10–15 phút mỗi ngày ôn lại phần này.';

  function splitItems(text) {
    return String(text || '').split(/\n|;|•/).map(x => x.replace(/^\s*[-–+*]\s*/, '').trim().replace(/[.。]+$/, '')).filter(Boolean);
  }
  function stripCon(t) { return expandAbbr(t).replace(/^con\s+/i, ''); }
  function expandAbbr(t) { return t.replace(/\bbtvn\b/gi, 'bài tập về nhà').replace(/\bktdg\b/gi, 'kiểm tra đầu giờ'); }
  /** phần ngữ cảnh cô ghi thêm, ví dụ "… khi viết lại câu" */
  function contextTail(t) { const m = /\s(khi|ở|trong|phần)\s.+$/i.exec(t); return m ? expandAbbr(m[0]) : ''; }
  function wordCount(t) { return t.split(/\s+/).filter(Boolean).length; }

  function strongBullets(text, scores, extra) {
    const items = splitItems(text);
    const phrases = [];
    extra = extra || [];
    if (items.length) {
      items.forEach(it => {
        const low = it.toLowerCase();
        if (wordCount(it) >= 10) { phrases.push(stripCon(it).replace(/^./, ch => ch.toLowerCase())); return; }
        const hits = [...new Set(STRONG_LIB.filter(([re]) => re.test(low)).map(x => x[1]))].slice(0, 2);
        if (!hits.length) { phrases.push(stripCon(it).replace(/^./, ch => ch.toLowerCase())); return; }
        phrases.push(hits.length > 1 ? hits.slice(0, -1).join(', ') + ' và ' + hits[hits.length - 1] : hits[0]);
      });
    } else {
      const good = scores.filter(x => x.value !== null && x.value >= 8).sort((a, b) => b.value - a.value);
      const mid = scores.filter(x => x.value !== null && x.value >= 6.5 && x.value < 8);
      if (good.length) phrases.push('đạt kết quả tốt ở phần ' + good.map(x => `${x.label} (${dot(x.value)})`).join(', '));
      else if (mid.length) phrases.push('có cố gắng ở phần ' + mid.map(x => `${x.label} (${dot(x.value)})`).join(', '));
      if (!extra.length) phrases.push('có ý thức học tập và tham gia đầy đủ các hoạt động trên lớp');
    }
    // phần chăm chỉ (BTVN / từ mới) gộp thành một ý, luôn giữ lại
    const all = extra.length ? [...phrases.slice(0, 2), extra.join(' và ')] : phrases;
    const pre = ['Con ', 'Bên cạnh đó, con ', 'Ngoài ra, con '];
    return all.slice(0, 3).map((ph, i) => `- ${pre[i]}${ph}${i === 1 && all.length > 1 ? ', thật đáng khích lệ' : ''}.`);
  }

  function weakBullets(text, scores, extra) {
    const items = splitItems(text);
    const out = [];
    extra = extra || [];
    if (items.length) {
      items.slice(0, 2).forEach(it => {
        const low = it.toLowerCase();
        const hit = WEAK_LIB.find(([re]) => re.test(low));
        const tip = hit ? hit[2] : DEFAULT_TIP;
        let sentence;
        if (wordCount(it) >= 10 || !hit) {
          const body = stripCon(it);
          sentence = /cần|nên|chưa/.test(low) ? 'Con ' + body.replace(/^./, ch => ch.toLowerCase()) : 'Con cần ' + body.replace(/^./, ch => ch.toLowerCase());
        } else {
          sentence = 'Con cần ' + hit[1] + contextTail(it);
        }
        out.push(`- ${sentence}. Gợi ý: ${tip}`);
      });
    } else {
      const low = scores.filter(x => x.value !== null && x.value < 8).sort((a, b) => a.value - b.value).slice(0, 2);
      low.forEach(x => {
        const key = /nghe/.test(x.label) ? 'nghe' : /nói/.test(x.label) ? 'nói' : 'ngữ pháp';
        const hit = WEAK_LIB.find(([re]) => re.test(key));
        out.push(`- Con cần ${hit[1]} (${x.label}: ${dot(x.value)}). Gợi ý: ${hit[2]}`);
      });
      if (!out.length && !extra.length) out.push('- Con tiếp tục duy trì phong độ và thử sức với bài nâng cao hơn. Gợi ý: mỗi tuần con làm thêm một đề nâng cao và tự chấm.');
    }
    // tối đa 3 ý để nhận xét không quá dài; ưu tiên ý cô ghi, rồi đến chăm chỉ
    return [...out.slice(0, 3 - Math.min(extra.length, 1)), ...extra].slice(0, 3);
  }

  /** Sheet điểm trên lớp ứng với tháng khảo sát (cùng số tháng); không có thì lấy tháng gần nhất có dữ liệu */
  function monthNo(t) { const m = /tháng\s*(\d+)/i.exec(t || ''); return m ? Number(m[1]) : null; }
  function diligenceSheet(sid) {
    const ks = sheetData(ui.cls, 'khaosat');
    const want = monthNo(sessionLabel(ks, sid));
    const list = scoreSheetsOf(ui.cls);
    const same = want !== null ? list.find(m => monthNo(m.name) === want) : null;
    const hasData = m => {
      const sh = sheetData(ui.cls, m.id);
      return classData(ui.cls).students.some(st => statColsOf(sh).some(x => x.def.key !== 'kttt' && statOf(sh, st.id, x.def, x.col).total));
    };
    if (same && hasData(same)) return same;
    for (let i = list.length - 1; i >= 0; i--) if (hasData(list[i])) return list[i];
    return same || null;
  }
  /** {btvn:{ok,total}, tumoi:{ok,total}, sheet} của một học sinh */
  function diligenceOf(stId, sid) {
    const m = diligenceSheet(sid);
    if (!m) return { sheet: null };
    const sh = sheetData(ui.cls, m.id);
    const out = { sheet: m };
    statColsOf(sh).forEach(x => { out[x.def.key] = statOf(sh, stId, x.def, x.col); });
    return out;
  }
  const MIN_SESSIONS = 2;   // cần ít nhất 2 buổi có dữ liệu mới nhận xét
  /** Câu nhận xét về sự chăm chỉ: {strong: [cụm từ], weak: [câu đầy đủ]} */
  function diligenceNotes(dg, strongText, weakText) {
    const told = (strongText || '') + ' ' + (weakText || '');
    const res = { strong: [], weak: [] };
    const b = dg.btvn;
    if (b && b.total >= MIN_SESSIONS && !/btvn|bài tập về nhà|bài về nhà/i.test(told)) {
      const r = b.ok / b.total;
      if (r >= 0.9) res.strong.push(`chăm chỉ làm bài tập về nhà đầy đủ (${b.ok}/${b.total} buổi)`);
      else if (r >= 0.6) res.weak.push(`- Con đã có ý thức làm bài tập về nhà nhưng cần làm thường xuyên hơn (${b.ok}/${b.total} buổi). Gợi ý: bố mẹ nhắc con làm bài ngay trong ngày được giao.`);
      else res.weak.push(`- Con cần chăm chỉ làm bài tập về nhà hơn (mới làm ${b.ok}/${b.total} buổi). Gợi ý: con đặt một khung giờ cố định mỗi tối để làm bài, bố mẹ kiểm tra giúp cô.`);
    }
    const v = dg.tumoi;
    if (v && v.total >= MIN_SESSIONS && !/từ mới|từ vựng/i.test(told)) {
      const r = v.ok / v.total;
      if (r >= 0.8) res.strong.push(`chăm học từ mới, đạt ${v.ok}/${v.total} bài kiểm tra từ vựng`);
      else if (r >= 0.5) res.weak.push(`- Con đã chăm học từ mới nhưng cần ôn thường xuyên hơn (đạt ${v.ok}/${v.total} bài kiểm tra). Gợi ý: mỗi ngày con ôn lại 5–10 từ bằng flashcard và ôn toàn bộ trước buổi học.`);
      else res.weak.push(`- Con cần chăm chỉ học từ mới hơn (mới đạt ${v.ok}/${v.total} bài kiểm tra). Gợi ý: mỗi ngày con học 5–10 từ mới bằng flashcard và nhờ bố mẹ kiểm tra lại.`);
    }
    return res;
  }

  /** Mẫu nhận xét gửi phụ huynh */
  function generateComment(st, sid, item) {
    const ks = sheetData(ui.cls, 'khaosat');
    const lbl = sessionLabel(ks, sid);
    const month = /^\s*tháng/i.test(lbl) ? lbl.trim().toLowerCase() : 'tháng ' + (new Date().getMonth() + 1);
    const scores = reviewScores(st.id, sid);
    const have = scores.filter(x => x.value !== null);
    const avg = avgOf(scores);
    const detail = have.map((x, i) => `${i === 0 ? cap(x.label) : x.label}: ${dot(x.value)}`).join(', ');
    const dn = diligenceNotes(diligenceOf(st.id, sid), item && item.strong, item && item.weak);
    const lines = [
      `🌷 Kính gửi bố mẹ nhận xét tình hình học tập môn Tiếng Anh ${month} của ${st.name} như sau:`,
      avg !== null ? `📊 1. Tổng điểm: ${dot1(avg)} (${detail})` : '📊 1. Tổng điểm: (chưa có điểm khảo sát)',
      '🌟 2. Điểm mạnh:',
      ...strongBullets(item && item.strong, scores, dn.strong),
      '🎯 3. Điểm cần cải thiện:',
      ...weakBullets(item && item.weak, scores, dn.weak),
      '💌 Cô giáo mong bố mẹ đồng hành, động viên để con ngày càng tiến bộ.',
      'Trân trọng!',
    ];
    return lines.join('\n');
  }
  function reviewItem(stId, sid) {
    const rv = sheetData(ui.cls, 'nhanxet');
    return (rv.items[sid] && rv.items[sid][stId]) || {};
  }
  function reviewText(st, sid) {
    const it = reviewItem(st.id, sid);
    return typeof it.text === 'string' && it.text ? it.text : generateComment(st, sid, it);
  }
  function setReviewField(stId, sid, field, value) {
    const rv = sheetData(ui.cls, 'nhanxet');
    if (!rv.items[sid]) rv.items[sid] = {};
    if (!rv.items[sid][stId]) rv.items[sid][stId] = {};
    if (value) rv.items[sid][stId][field] = value; else delete rv.items[sid][stId][field];
    sync(COL_SHEETS, sheetDocId(ui.cls, 'nhanxet'), ['items', sid, stId, field], value || undefined);
    save();
  }

  function renderReview() {
    const ks = sheetData(ui.cls, 'khaosat');
    const students = classData(ui.cls).students;
    const sid = reviewMonth();
    const cols = sid ? colsFor(ks, sid).filter(c => c.type === 'score') : [];
    const label = sid ? sessionLabel(ks, sid) : '';
    let h = `<h2 class="print-title">${esc(className(ui.cls))} – Nhận xét ${esc(label)}</h2>`;
    h += `<table class="grid review"><thead><tr><th class="sticky c-stt">STT</th><th class="sticky c-name">Họ và tên</th>`;
    cols.forEach(c => { h += `<th class="sub">${esc(cap(shortLabel(c.label)))}<div class="muted">${esc(label)}</div></th>`; });
    const dsh = sid ? diligenceSheet(sid) : null;
    h += `<th>Tổng điểm</th><th class="stat-h">Làm BTVN<div class="muted">${esc(dsh ? dsh.name : '')}</div></th><th class="stat-h">Đạt từ mới<div class="muted">${esc(dsh ? dsh.name : '')}</div></th><th class="rv-col">🌟 Điểm mạnh</th><th class="rv-col">🎯 Điểm cần cải thiện</th></tr></thead><tbody>`;
    if (!students.length) h += `<tr><td class="empty" colspan="${7 + cols.length}">Lớp chưa có học sinh.</td></tr>`;
    students.forEach((st, i) => {
      const item = reviewItem(st.id, sid);
      const scores = cols.map(c => ({ c, v: toTen(getCell(ks, st.id, sid, c.key), getTotal(ks, sid, c.key)) }));
      const avg = avgOf(scores.map(x => ({ value: x.v })));
      h += `<tr data-st="${esc(st.id)}"><td class="sticky c-stt">${i + 1}</td><td class="sticky c-name"><span class="rv-name">${esc(st.name)}</span></td>`;
      scores.forEach(x => { h += `<td class="score ${targetClass(ks, st.id, x.v, x.c)}"><b>${x.v === null ? '–' : fmt(x.v)}</b></td>`; });
      h += `<td class="score ${avg === null ? '' : avg >= 5 ? 'tgt-hit' : 'tgt-low'}"><b>${avg === null ? '–' : fmt(Math.round(avg * 10) / 10)}</b></td>`;
      const dg = diligenceOf(st.id, sid);
      h += `<td class="stat">${pctHTML(dg.btvn || { ok: 0, total: 0 })}</td><td class="stat">${pctHTML(dg.tumoi || { ok: 0, total: 0 })}</td>`;
      h += `<td class="rv-cell"><textarea data-rv="strong" rows="2" ${i === 0 ? 'placeholder="VD: nói tự tin; chăm học từ mới"' : ''}>${esc(item.strong || '')}</textarea></td>`;
      h += `<td class="rv-cell"><textarea data-rv="weak" rows="2" ${i === 0 ? 'placeholder="VD: đọc kỹ đề; lỗi nhỏ khi viết lại câu"' : ''}>${esc(item.weak || '')}</textarea></td></tr>`;
    });
    h += '</tbody></table>';
    h += `<div class="rv-cards"><h3>💌 Nhận xét gửi phụ huynh – ${esc(label)}</h3>`;
    students.forEach(st => {
      const it = reviewItem(st.id, sid);
      const edited = typeof it.text === 'string' && !!it.text;
      h += `<div class="rv-card" data-card="${esc(st.id)}"><div class="rv-head"><b>${esc(st.name)}</b>
        <span class="rv-flag" ${edited ? '' : 'hidden'}>✏️ đã sửa tay</span>
        <span class="spacer"></span>
        <button class="btn" data-rvregen="${esc(st.id)}" ${edited ? '' : 'hidden'} title="Bỏ chỗ sửa tay, viết lại theo điểm mạnh / cần cải thiện">↺ Viết lại</button>
        <button class="btn primary" data-rvcopy="${esc(st.id)}">📋 Sao chép</button></div>
        <textarea data-rvtext="${esc(st.id)}" rows="12">${esc(reviewText(st, sid))}</textarea></div>`;
    });
    h += '</div>';
    $('#content').innerHTML = h;
    document.querySelectorAll('#content [data-rvtext]').forEach(autoSize);
    fixHeader();
  }
  function autoSize(ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 4) + 'px'; }
  /** Cập nhật thẻ nhận xét của một học sinh khi cô sửa điểm mạnh / cần cải thiện */
  function refreshCard(stId) {
    const st = classData(ui.cls).students.find(s => s.id === stId);
    const card = document.querySelector(`[data-card="${CSS.escape(stId)}"]`);
    if (!st || !card) return;
    const sid = reviewMonth();
    const it = reviewItem(stId, sid);
    const edited = typeof it.text === 'string' && !!it.text;
    const ta = card.querySelector('textarea');
    if (document.activeElement !== ta) ta.value = reviewText(st, sid);
    autoSize(ta);
    card.querySelector('.rv-flag').hidden = !edited;
    card.querySelector('[data-rvregen]').hidden = !edited;
  }
  async function copyText(text) {
    let ok = false;
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    return ok;
  }
  function toast(msg) { updateUndoButtons(msg); }

  // ---------- Hành động ----------
  function addStudents(names) {
    const c = classData(ui.cls);
    const base = Math.max(Date.now(), ...c.students.map(s => (s.order || 0) + 1));
    names.map(x => x.trim()).filter(Boolean).forEach((name, i) => {
      const st = { id: uid(), name, order: base + i };
      c.students.push(st);
      sync(COL_CLASSES, ui.cls, ['students', st.id], { name, order: st.order });
    });
    save();
    renderContent();
  }

  // ---------- Quản lý lớp: thêm / đổi tên / xoá (vào thùng rác) / khôi phục ----------
  function fullClassName(c) { return c.group ? c.group + ' – ' + c.name : c.name; }
  function renderClassManager() {
    $('#classList').innerHTML = CLASSES.map((c, i) => `
      <li><span class="cl-name">${esc(fullClassName(c))}</span>
        <span class="muted">${classData(c.id).students.length} HS</span>
        <span class="cl-actions">
          <button type="button" class="btn" data-clsup="${i}" ${i === 0 ? 'disabled' : ''} title="Lên">↑</button>
          <button type="button" class="btn" data-clsdown="${i}" ${i === CLASSES.length - 1 ? 'disabled' : ''} title="Xuống">↓</button>
          <button type="button" class="btn" data-clsren="${esc(c.id)}">Đổi tên</button>
          <button type="button" class="btn danger-soft" data-clsdel="${esc(c.id)}">Xoá</button>
        </span></li>`).join('');
    const mTrash = [];
    CLASSES.forEach(c => (c.monthsTrash || []).forEach(m => mTrash.push({ c, m })));
    $('#monthTrashBox').hidden = !mTrash.length;
    $('#monthTrashList').innerHTML = mTrash.map(({ c, m }) => `
      <li><span class="cl-name">${esc(fullClassName(c))} – ${esc(m.name)}</span>
        <span class="muted">xoá lúc ${esc(new Date(m.deletedAt || 0).toLocaleString('vi-VN'))}</span>
        <span class="cl-actions"><button type="button" class="btn primary" data-monrestore="${esc(m.id)}" data-moncls="${esc(c.id)}">↺ Khôi phục</button></span></li>`).join('');
    $('#trashBox').hidden = !TRASH.length;
    $('#trashList').innerHTML = TRASH.map(c => `
      <li><span class="cl-name">${esc(fullClassName(c))}</span>
        <span class="muted">${classData(c.id).students.length} HS · xoá lúc ${esc(new Date(c.deletedAt || 0).toLocaleString('vi-VN'))}</span>
        <span class="cl-actions"><button type="button" class="btn primary" data-clsrestore="${esc(c.id)}">↺ Khôi phục</button></span></li>`).join('');
  }
  function openClassManager() {
    $('#newClassName').value = '';
    renderClassManager();
    $('#classDialog').showModal();
  }
  function afterClassChange() {
    saveConfig();
    renderClassManager();
    renderClassTabs();
    renderToolbar();
    renderContent();
  }
  function addClass() {
    const name = $('#newClassName').value.trim();
    if (!name) { $('#newClassName').focus(); return; }
    if ([...CLASSES, ...TRASH].some(c => fullClassName(c).toLowerCase() === name.toLowerCase() || c.name.toLowerCase() === name.toLowerCase())) {
      if (!confirm(`Đã có lớp tên “${name}” (hoặc trong mục Lớp đã xoá). Vẫn tạo lớp mới trùng tên?`)) return;
    }
    const c = { id: 'c' + uid(), name };
    CLASSES.push(c);
    $('#newClassName').value = '';
    ui.cls = c.id; ui.session = 'all'; saveUI();
    afterClassChange();
  }
  function renameClass(id) {
    const c = CLASSES.find(x => x.id === id);
    if (!c) return;
    const name = prompt('Tên mới cho lớp:', c.name);
    if (!name || !name.trim()) return;
    c.name = name.trim();
    afterClassChange();
  }
  function deleteClass(id) {
    const c = CLASSES.find(x => x.id === id);
    if (!c) return;
    const n = classData(id).students.length;
    if (!confirm(`Xoá lớp “${fullClassName(c)}” (${n} học sinh)?\n\nLớp sẽ được chuyển vào mục “Lớp đã xoá”. Học sinh và điểm vẫn được giữ nguyên, bạn có thể KHÔI PHỤC lại bất cứ lúc nào.`)) return;
    const pos = CLASSES.findIndex(x => x.id === id);
    CLASSES = CLASSES.filter(x => x.id !== id);
    TRASH.unshift(Object.assign({}, c, { deletedAt: Date.now(), pos }));
    if (ui.cls === id) { ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls; ui.session = 'all'; saveUI(); }
    afterClassChange();
  }
  function restoreClass(id) {
    const c = TRASH.find(x => x.id === id);
    if (!c) return;
    TRASH = TRASH.filter(x => x.id !== id);
    const back = Object.assign({}, c);
    delete back.deletedAt;
    delete back.pos;
    const pos = Number.isInteger(c.pos) ? Math.min(Math.max(c.pos, 0), CLASSES.length) : CLASSES.length;
    CLASSES.splice(pos, 0, back);
    ui.cls = id; ui.session = 'all'; saveUI();
    afterClassChange();
  }
  function moveClass(i, d) {
    const j = i + d;
    if (j < 0 || j >= CLASSES.length) return;
    [CLASSES[i], CLASSES[j]] = [CLASSES[j], CLASSES[i]];
    afterClassChange();
  }

  /** Sắp xếp học sinh theo tên (chữ cuối), rồi đến họ và tên đệm – theo bảng chữ cái tiếng Việt */
  const viCollator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
  function nameKey(full) {
    const w = String(full || '').trim().split(/\s+/);
    return { given: w[w.length - 1] || '', rest: w.slice(0, -1).join(' ') };
  }
  function sortStudents() {
    const c = classData(ui.cls);
    if (c.students.length < 2) return;
    if (!confirm(`Sắp xếp ${c.students.length} học sinh của ${className(ui.cls)} theo tên A→Z?\n(Ví dụ “Thu An” xếp theo chữ “An”.)`)) return;
    c.students.sort((a, b) => {
      const x = nameKey(a.name), y = nameKey(b.name);
      return viCollator.compare(x.given, y.given) || viCollator.compare(x.rest, y.rest) || viCollator.compare(a.name, b.name);
    });
    c.students.forEach((st, i) => {
      st.order = i + 1;
      sync(COL_CLASSES, ui.cls, ['students', st.id, 'order'], st.order);
    });
    save();
    renderContent();
  }

  function deleteStudent(id) {
    const c = classData(ui.cls);
    const st = c.students.find(s => s.id === id);
    if (!st) return;
    if (!confirm(`Xoá học sinh “${st.name}” và toàn bộ điểm của em ở tất cả các sheet?`)) return;
    c.students = c.students.filter(s => s.id !== id);
    Object.values(c.sheets).forEach(sh => { if (sh.data) delete sh.data[id]; if (sh.targets) delete sh.targets[id]; });
    sync(COL_CLASSES, ui.cls, ['students', id], undefined);
    sheetsOf(ui.cls).filter(d => d.type === 'sessions').forEach(d => {
      sync(COL_SHEETS, sheetDocId(ui.cls, d.id), ['data', id], undefined);
      if (d.target) sync(COL_SHEETS, sheetDocId(ui.cls, d.id), ['targets', id], undefined);
    });
    save();
    renderContent();
  }

  function syncColsSessions(sh) {
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
  }

  /** Ô chọn buổi trong hộp thoại thêm / xoá cột */
  function sessionPicker(box, checkedIds) {
    const sh = sheetData(ui.cls, ui.sheet);
    box.innerHTML = sh.sessions.map(s => `<label class="pick" style="--h:${hueOf(sh, s.id)}"><input type="checkbox" value="${esc(s.id)}" ${checkedIds.includes(s.id) ? 'checked' : ''}> ${esc(sessionLabel(sh, s.id))}</label>`).join('') +
      '<span class="pick-all"><button type="button" class="btn" data-pickall="1">Chọn tất cả</button><button type="button" class="btn" data-pickall="0">Bỏ chọn</button></span>';
  }
  function pickedSessions(box) { return [...box.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value); }

  function openAddColumn() {
    const sh = sheetData(ui.cls, ui.sheet);
    $('#colName').value = '';
    $('#colType').value = 'score';
    sessionPicker($('#colSessions'), sh.sessions.map(s => s.id));
    $('#colDialog').showModal();
  }

  function addColumn(label, type, sids) {
    const sh = sheetData(ui.cls, ui.sheet);
    if (!sids.length) { alert('Hãy chọn ít nhất một buổi.'); return; }
    const col = { key: 'c' + uid(), label, type };
    if (sids.length < sh.sessions.length) col.only = sids;
    sh.cols.push(col);
    syncColsSessions(sh);
    save();
    renderContent();
  }

  /** Đổi chỗ cột: thứ tự cột dùng chung cho mọi buổi của lớp / sheet này */
  function placeColumn(key, targetKey, after) {
    const sh = sheetData(ui.cls, ui.sheet);
    if (key === targetKey) return;
    const col = sh.cols.find(c => c.key === key);
    if (!col || !sh.cols.some(c => c.key === targetKey)) return;
    const rest = sh.cols.filter(c => c.key !== key);
    const j = rest.findIndex(c => c.key === targetKey) + (after ? 1 : 0);
    rest.splice(j, 0, col);
    if (rest.map(c => c.key).join() === sh.cols.map(c => c.key).join()) return;
    sh.cols = rest;
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    save();
    renderContent();
  }
  function moveColumn(key, sid, dir) {
    const sh = sheetData(ui.cls, ui.sheet);
    const vis = colsFor(sh, sid);
    const i = vis.findIndex(c => c.key === key);
    const other = vis[i + dir];
    if (i < 0 || !other) return;
    placeColumn(key, other.key, dir > 0);
    const btn = document.querySelector(`[data-colmove="${CSS.escape(key)}"][data-colmovesess="${CSS.escape(sid)}"][data-dir="${dir}"]`);
    if (btn && !btn.disabled) btn.focus({ preventScroll: true });
  }

  function openDeleteColumn(key, sid) {
    const sh = sheetData(ui.cls, ui.sheet);
    if (!sh.cols.length) { alert('Không còn cột nào để xoá.'); return; }
    $('#delColSel').innerHTML = sh.cols.map(c => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('');
    if (key) $('#delColSel').value = key;
    sessionPicker($('#delColSessions'), sid ? [sid] : sh.sessions.map(s => s.id));
    $('#delColDialog').showModal();
  }

  /** Xoá cột khỏi các buổi đã chọn; chọn tất cả các buổi thì xoá hẳn cột */
  function deleteColumn(key, sids) {
    const sh = sheetData(ui.cls, ui.sheet);
    const col = sh.cols.find(c => c.key === key);
    if (!col || !sids.length) return;
    const shown = sh.sessions.map(s => s.id).filter(id => colsFor(sh, id).includes(col));
    const remain = shown.filter(id => !sids.includes(id));
    const names = sids.length === sh.sessions.length ? 'tất cả các buổi' : sids.map(id => sessionLabel(sh, id)).join(', ');
    if (!confirm(`Xoá cột “${col.label}” khỏi ${names}?\nĐiểm trong cột ở các buổi này sẽ bị xoá.`)) return;
    if (!remain.length) {
      sh.cols = sh.cols.filter(c => c.key !== key);
    } else {
      col.skip = [...new Set([...(col.skip || []), ...sids])];
    }
    Object.entries(sh.data).forEach(([stId, byS]) => sids.forEach(sid => {
      if (byS[sid] && key in byS[sid]) {
        delete byS[sid][key];
        sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['data', stId, sid, key], undefined);
      }
    }));
    sids.forEach(sid => {
      if (sh.totals[sid] && key in sh.totals[sid]) {
        delete sh.totals[sid][key];
        sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['totals', sid, key], undefined);
      }
    });
    syncColsSessions(sh);
    save();
    renderContent();
  }

  function renameColumn(key) {
    const sh = sheetData(ui.cls, ui.sheet);
    const col = sh.cols.find(c => c.key === key);
    if (!col) return;
    const name = prompt('Tên mới cho cột:', col.label);
    if (name && name.trim()) { col.label = name.trim(); sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols); save(); renderContent(); }
  }

  function addSession() {
    const sh = sheetData(ui.cls, ui.sheet);
    sh.sessions.push({ id: 's' + uid() });
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    save();
    renderToolbar();
    renderContent();
  }

  function deleteSession(sid) {
    const sh = sheetData(ui.cls, ui.sheet);
    const label = sessionLabel(sh, sid);
    if (!confirm(`Xoá ${label} và toàn bộ điểm của buổi này? Các buổi sau sẽ được đánh số lại.`)) return;
    sh.sessions = sh.sessions.filter(s => s.id !== sid);
    Object.values(sh.data).forEach(byS => { delete byS[sid]; });
    delete sh.totals[sid];
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['cols'], sh.cols);
    if (String(ui.session) === sid) { ui.session = 'all'; saveUI(); }
    save();
    renderToolbar();
    renderContent();
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function exportCsv() {
    const def = sheetDef(ui.sheet);
    const sh = sheetData(ui.cls, ui.sheet);
    const rows = [];
    if (def.type === 'sessions') {
      const students = classData(ui.cls).students;
      const hasTarget = !!def.target;
      const head = ['STT', 'Họ và tên'].concat(hasTarget ? ['Điểm mục tiêu'] : []);
      const totalsRow = ['', 'Tổng số câu'].concat(hasTarget ? [''] : []);
      sh.sessions.forEach(s => colsFor(sh, s.id).forEach(c => {
        head.push(`${sessionLabel(sh, s.id)}${s.date ? ' (' + s.date + ')' : ''} - ${c.label}${c.type === 'score' ? ' (/10)' : ''}`);
        totalsRow.push(c.type === 'score' ? (getTotal(sh, s.id, c.key) ?? '') : '');
      }));
      const stats = isClassScore(ui.sheet) ? statColsOf(sh) : [];
      head.push('Tổng số buổi đi học', 'Số buổi vắng', 'Điểm TB (/10)', ...stats.map(x => x.def.title));
      rows.push(head, totalsRow);
      students.forEach((st, i) => {
        const r = [i + 1, st.name].concat(hasTarget ? [fmt(num(sh.targets[st.id]))] : []);
        sh.sessions.forEach(s => colsFor(sh, s.id).forEach(c => {
          const v = getCell(sh, st.id, s.id, c.key);
          if (c.type === 'attend') r.push(isPresent(v) ? 'có mặt' : isAbsent(v) ? 'vắng' : '');
          else if (c.type === 'check') r.push(isPresent(v) ? '✓' : isAbsent(v) ? '✗' : '');
          else if (c.type === 'text') r.push(v ?? '');
          else r.push(fmt(toTen(v, getTotal(sh, s.id, c.key))));
        }));
        const att = attendance(sh, st.id);
        r.push(att === null ? '' : att, absences(sh, st.id), fmt(studentAvg(sh, st.id)));
        stats.forEach(x => { const q = statOf(sh, st.id, x.def, x.col); r.push(q.total ? `${Math.round(q.ok / q.total * 100)}% (${q.ok}/${q.total})` : ''); });
        rows.push(r);
      });
    } else if (def.type === 'review') {
      const ks = sheetData(ui.cls, 'khaosat');
      const sid = reviewMonth();
      const cols = colsFor(ks, sid).filter(c => c.type === 'score');
      rows.push(['STT', 'Họ và tên', ...cols.map(c => cap(shortLabel(c.label))), 'Tổng điểm', 'Điểm mạnh', 'Điểm cần cải thiện', 'Nhận xét']);
      classData(ui.cls).students.forEach((st, i) => {
        const sc = cols.map(c => toTen(getCell(ks, st.id, sid, c.key), getTotal(ks, sid, c.key)));
        const it = reviewItem(st.id, sid);
        const avg = avgOf(sc.map(v => ({ value: v })));
        rows.push([i + 1, st.name, ...sc.map(fmt), avg === null ? '' : fmt(Math.round(avg * 10) / 10), it.strong || '', it.weak || '', reviewText(st, sid)]);
      });
    } else {
      rows.push(['STT / Tuần', 'Ngày', 'Kỹ năng', 'Nội dung bài học', 'Tài liệu', 'Mục tiêu (band)', 'Hoàn thành', 'Ghi chú']);
      sh.rows.forEach(r => rows.push([r.week, r.date, r.skill, r.content, r.material, r.target, r.done ? 'x' : '', r.note]));
    }
    // Dấu ; để Excel (cài đặt Việt Nam, dấu phẩy thập phân) mở đúng cột
    const csv = '﻿' + 'sep=;\n' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
    download(`${className(ui.cls)} - ${sheetTitle(ui.cls, ui.sheet)}${def.type === 'review' ? ' ' + sessionLabel(sheetData(ui.cls, 'khaosat'), reviewMonth()) : ''}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function backupText() { saveNow(); return JSON.stringify(state); }

  function backupFile() {
    const d = new Date().toISOString().slice(0, 10);
    download(`so-diem-sao-luu-${d}.json`, backupText(), 'application/json');
  }

  function openBackup() {
    $('#backupText').value = backupText();
    $('#backupMsg').textContent = '';
    $('#backupDialog').showModal();
    $('#backupText').select();
  }

  async function copyBackup() {
    const ta = $('#backupText');
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard) {
      try { await navigator.clipboard.writeText(ta.value); ok = true; } catch (e) { ok = false; }
    }
    $('#backupMsg').textContent = ok ? '✅ Đã sao chép. Mở web mới → Khôi phục → dán vào.' : 'Không tự sao chép được: hãy bấm vào ô, nhấn Ctrl+A rồi Ctrl+C (điện thoại: giữ tay → Chọn tất cả → Sao chép).';
  }

  /** Nạp dữ liệu sao lưu (chuỗi JSON) – ghi đè dữ liệu hiện tại */
  function restoreText(text) {
    try {
      const data = JSON.parse(String(text).trim());
      if (!data || typeof data.classes !== 'object') throw new Error('Dữ liệu không đúng định dạng sổ điểm');
      if (!confirm('Khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại' + (cloud ? ' (bảng điểm chung của mọi người)' : '') + '. Tiếp tục?')) return false;
      state = data;
      applyConfig(state.config);
      if (!CLASSES.some(c => c.id === ui.cls)) ui.cls = CLASSES.length ? CLASSES[0].id : ui.cls;
      saveNow();
      renderAll();
      if (cloud) uploadAll();
      resetUndo();
      alert('Đã khôi phục dữ liệu.');
      return true;
    } catch (e) {
      alert('Không đọc được dữ liệu: ' + e.message);
      return false;
    }
  }

  function restore(file) {
    const reader = new FileReader();
    reader.onload = () => { if (restoreText(reader.result)) $('#restoreDialog').close(); };
    reader.readAsText(file);
  }

  // ---------- Sự kiện ----------
  document.addEventListener('click', e => {
    const dm = e.target.closest && e.target.closest('[data-delmonth]');
    if (dm) { e.preventDefault(); commitUndo(); deleteMonth(dm.dataset.delmonth); return; }
    const t = e.target.closest('button');
    if (!t) return;
    // mỗi lần bấm nút là một bước hoàn tác riêng
    if (t.id !== 'undoBtn' && t.id !== 'redoBtn') commitUndo();
    const d = t.dataset;
    if (d.close) { t.closest('dialog').close(); return; }
    if (d.cls) { ui.cls = d.cls; ui.session = 'all'; validSheet(); saveUI(); renderAll(); return; }
    if (d.monrestore) { restoreMonth(d.moncls, d.monrestore); return; }
    if (d.rvcopy) {
      const st = classData(ui.cls).students.find(s => s.id === d.rvcopy);
      const ta = document.querySelector(`[data-rvtext="${CSS.escape(d.rvcopy)}"]`);
      if (st && ta) copyText(ta.value).then(ok => toast(ok ? `📋 Đã sao chép nhận xét của ${st.name}` : 'Không sao chép được – hãy chọn chữ rồi Ctrl+C'));
      return;
    }
    if (d.rvregen) {
      setReviewField(d.rvregen, reviewMonth(), 'text', '');
      refreshCard(d.rvregen);
      return;
    }
    if (d.sheet) {
      if (d.sheet === 'trenlop' && isClassScore(ui.sheet) && !t.classList.contains('month-tab')) return;
      if (d.sheet === ui.sheet) return;   // đã mở rồi: không vẽ lại (để bấm đúp đổi tên được)
      ui.sheet = d.sheet; ui.session = 'all'; saveUI(); renderAll(); return;
    }
    if (d.del) { deleteStudent(d.del); return; }
    if (d.clsdel) { deleteClass(d.clsdel); return; }
    if (d.clsren) { renameClass(d.clsren); return; }
    if (d.clsrestore) { restoreClass(d.clsrestore); return; }
    if (d.clsup) { moveClass(Number(d.clsup), -1); return; }
    if (d.clsdown) { moveClass(Number(d.clsdown), 1); return; }
    if (d.delcol) { openDeleteColumn(d.delcol, d.delcolsess); return; }
    if (d.colmove) { moveColumn(d.colmove, d.colmovesess, Number(d.dir)); return; }
    if (d.pickall) { t.closest('dialog').querySelectorAll('.pick input').forEach(i => { i.checked = d.pickall === '1'; }); return; }
    if (d.delsess) { deleteSession(d.delsess); return; }
    if (d.attcell) {
      // Vòng: trống → ✓ → ✗ → trống (điểm danh, BTVN, chép nghe, chép phạt…)
      const tr = t.closest('tr[data-st]');
      const [sid, key] = d.attcell.split('|');
      const sh = sheetData(ui.cls, ui.sheet);
      const v = getCell(sh, tr.dataset.st, sid, key);
      const next = isPresent(v) ? 'x' : isAbsent(v) ? null : true;
      writeCell(tr.dataset.st, sid, key, next);
      renderContent();
      const again = document.querySelector(`tr[data-st="${CSS.escape(tr.dataset.st)}"] [data-attcell="${CSS.escape(d.attcell)}"]`);
      if (again) again.focus();
      return;
    }
    if (d.delrow !== undefined) {
      const sh = sheetData(ui.cls, ui.sheet);
      if (confirm('Xoá dòng kế hoạch này?')) { sh.rows.splice(Number(d.delrow), 1); sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['rows'], sh.rows); save(); renderContent(); }
      return;
    }
    switch (t.id) {
      case 'addStudent': {
        const inp = $('#newStudent');
        addStudents([inp.value]);
        inp.value = '';
        inp.focus();
        break;
      }
      case 'sortNames': sortStudents(); break;
      case 'addMonth': addMonth(); break;
      case 'copyAllReviews': {
        const sid = reviewMonth();
        const txt = classData(ui.cls).students.map(st => reviewText(st, sid)).join('\n\n────────────\n\n');
        copyText(txt).then(ok => toast(ok ? '📋 Đã sao chép nhận xét của cả lớp' : 'Không sao chép được'));
        break;
      }
      case 'regenAllReviews': {
        const sid = reviewMonth();
        const rv = sheetData(ui.cls, 'nhanxet');
        const ids = Object.keys(rv.items[sid] || {}).filter(id => rv.items[sid][id].text);
        if (!ids.length) { toast('Chưa có nhận xét nào sửa tay'); break; }
        if (!confirm(`Bỏ phần sửa tay của ${ids.length} nhận xét và viết lại tự động? (Có thể Hoàn tác)`)) break;
        ids.forEach(id => setReviewField(id, sid, 'text', ''));
        renderContent();
        break;
      }
      case 'undoBtn': doUndo(); break;
      case 'redoBtn': doRedo(); break;
      case 'manageClasses': openClassManager(); break;
      case 'addClassBtn': addClass(); break;
      case 'bulkAdd': $('#bulkNames').value = ''; $('#bulkDialog').showModal(); break;
      case 'addCol': openAddColumn(); break;
      case 'delCol': openDeleteColumn(); break;
      case 'addSession': addSession(); break;
      case 'addPlan': {
        const sh = sheetData(ui.cls, ui.sheet);
        sh.rows.push({ week: String(sh.rows.length + 1), date: '', skill: 'Listening', content: '', material: '', target: '', done: false, note: '' });
        sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['rows'], sh.rows);
        save();
        renderContent();
        break;
      }
      case 'exportCsv': exportCsv(); break;
      case 'printBtn': window.print(); break;
      case 'backupBtn': openBackup(); break;
      case 'copyBackup': copyBackup(); break;
      case 'fileBackup': backupFile(); break;
      case 'restoreBtn': $('#restoreText').value = ''; $('#restoreDialog').showModal(); break;
      case 'restorePasteOk': if (restoreText($('#restoreText').value)) $('#restoreDialog').close(); break;
      case 'restoreFile': $('#importFile').click(); break;
    }
  });

  // Ô điểm: khi bấm vào thì hiện số câu đúng để sửa, khi rời ô thì hiện điểm /10
  document.addEventListener('focusin', e => {
    const t = e.target;
    // chuyển sang ô khác: chốt bước hoàn tác của ô trước
    if (t.closest && t.closest('#content')) commitUndo();
    if (t.dataset && t.dataset.kind === 'score') {
      const tr = t.closest('tr[data-st]');
      const [sid, key] = t.dataset.cell.split('|');
      const v = getCell(sheetData(ui.cls, ui.sheet), tr.dataset.st, sid, key);
      t.value = num(v) === null ? '' : fmt(num(v));
      t.select();
    }
  });
  document.addEventListener('focusout', e => {
    const t = e.target;
    if (t.dataset && t.dataset.kind === 'score') {
      const tr = t.closest('tr[data-st]');
      const [sid, key] = t.dataset.cell.split('|');
      setTimeout(() => updateScoreCell(tr, sid, key), 0);
    }
  });

  document.addEventListener('dblclick', e => {
    const sl = e.target.closest && e.target.closest('[data-rensess]');
    if (sl) {
      const sh = sheetData(ui.cls, ui.sheet);
      const ses = sh.sessions.find(x => x.id === sl.dataset.rensess);
      if (!ses) return;
      const name = prompt('Tên buổi (để trống = dùng tên mặc định "Buổi n"):', ses.name || sessionLabel(sh, ses.id));
      if (name === null) return;
      const i = sh.sessions.indexOf(ses);
      if (!name.trim() || name.trim() === 'Buổi ' + (i + 1)) delete ses.name; else ses.name = name.trim();
      sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
      save(); renderToolbar(); renderContent();
      return;
    }
    const mt = (e.target.closest && e.target.closest('button.month-tab[data-sheet]')) ||
      (e.target.closest && e.target.closest('#monthTabs') && document.querySelector('#monthTabs button.month-tab.active'));
    if (mt) { renameMonth(mt.dataset.sheet); return; }
    const lbl = e.target.closest('[data-rencol]');
    if (lbl) renameColumn(lbl.dataset.rencol);
  });

  // ---------- Kéo thả tiêu đề cột để đổi chỗ ----------
  let dragCol = null;
  function clearDropMarks() { document.querySelectorAll('#content th.drop-before, #content th.drop-after').forEach(th => th.classList.remove('drop-before', 'drop-after')); }
  $('#content').addEventListener('dragstart', e => {
    const th = e.target.closest && e.target.closest('th[data-dragcol]');
    if (!th) return;
    dragCol = { key: th.dataset.dragcol, sid: th.dataset.dragsess };
    th.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragCol.key); } catch (err) { /* ignore */ }
  });
  $('#content').addEventListener('dragover', e => {
    if (!dragCol) return;
    const th = e.target.closest && e.target.closest('th[data-dragcol]');
    clearDropMarks();
    if (!th || th.dataset.dragsess !== dragCol.sid || th.dataset.dragcol === dragCol.key) return;
    e.preventDefault();
    const r = th.getBoundingClientRect();
    th.classList.add(e.clientX > r.left + r.width / 2 ? 'drop-after' : 'drop-before');
  });
  $('#content').addEventListener('drop', e => {
    if (!dragCol) return;
    const th = e.target.closest && e.target.closest('th[data-dragcol]');
    e.preventDefault();
    if (th && th.dataset.dragsess === dragCol.sid) {
      commitUndo();
      const r = th.getBoundingClientRect();
      placeColumn(dragCol.key, th.dataset.dragcol, e.clientX > r.left + r.width / 2);
    }
    clearDropMarks();
    dragCol = null;
  });
  $('#content').addEventListener('dragend', () => {
    clearDropMarks();
    document.querySelectorAll('#content th.dragging').forEach(th => th.classList.remove('dragging'));
    dragCol = null;
  });

  // ---------- Di chuyển giữa các ô bằng phím mũi tên (như Excel) ----------
  const NAV_SEL = 'input:not([type=hidden]):not([type=date]):not([type=checkbox]), textarea, select, button.att-btn, input[type=checkbox]';
  function navCells(tr) {
    return [...tr.querySelectorAll(NAV_SEL)].filter(el => !el.disabled && el.offsetParent !== null);
  }
  function navRows() {
    return [...document.querySelectorAll('#content thead tr.totals-row, #content tbody tr')].filter(tr => navCells(tr).length);
  }
  function centerX(el) { const r = (el.closest('td,th') || el).getBoundingClientRect(); return r.left + r.width / 2; }
  /** Cuộn để ô không bị cột cố định bên trái / hàng tiêu đề che mất */
  function ensureVisible(el) {
    const wrap = $('#content');
    const cell = el.closest('td,th') || el;
    const r = cell.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    let leftEdge = w.left;
    wrap.querySelectorAll('thead tr:first-child th.sticky').forEach(th => { leftEdge = Math.max(leftEdge, th.getBoundingClientRect().right); });
    const head = wrap.querySelector('thead');
    const topEdge = head && !cell.closest('thead') ? head.getBoundingClientRect().bottom : w.top;
    const isSticky = cell.classList.contains('sticky');
    if (!isSticky && r.left < leftEdge) wrap.scrollLeft -= (leftEdge - r.left) + 4;
    else if (r.right > w.right) wrap.scrollLeft += (r.right - w.right) + 4;
    if (r.top < topEdge) wrap.scrollTop -= (topEdge - r.top) + 4;
    else if (r.bottom > w.bottom) wrap.scrollTop += (r.bottom - w.bottom) + 4;
  }
  function goTo(el) {
    if (!el) return false;
    el.focus({ preventScroll: true });
    ensureVisible(el);
    if (el.tagName === 'INPUT' && el.type === 'text' && el.select) { try { el.select(); } catch (err) { /* ignore */ } }
    return true;
  }
  function moveFrom(el, dir) {
    const tr = el.closest('tr');
    if (!tr) return false;
    if (dir === 'left' || dir === 'right') {
      const cells = navCells(tr);
      const i = cells.indexOf(el);
      return goTo(cells[i + (dir === 'right' ? 1 : -1)]);
    }
    const rows = navRows();
    let i = rows.indexOf(tr);
    const x = centerX(el);
    while (true) {
      i += dir === 'down' ? 1 : -1;
      if (i < 0 || i >= rows.length) return false;
      const cells = navCells(rows[i]);
      // ô trong dòng kia nằm thẳng cột nhất (kể cả ô gộp nhiều cột như dòng ghi chú)
      let best = null, bestD = Infinity;
      cells.forEach(c => {
        const box = (c.closest('td,th') || c).getBoundingClientRect();
        const d = x >= box.left && x <= box.right ? 0 : Math.min(Math.abs(x - box.left), Math.abs(x - box.right));
        if (d < bestD) { bestD = d; best = c; }
      });
      if (best) return goTo(best);
    }
  }
  /** Ô chữ dài (tên, ghi chú): chỉ nhảy ô khi con trỏ đã ở đầu / cuối */
  function caretAllows(el, dir) {
    const isLongText = el.tagName === 'TEXTAREA' || el.classList.contains('name') || (el.dataset.plan && el.tagName === 'INPUT');
    if (!isLongText) return true;
    let a, b;
    try { a = el.selectionStart; b = el.selectionEnd; } catch (err) { return true; }
    if (a == null) return true;
    const len = el.value.length;
    if (dir === 'left') return a === 0 && b === 0;
    if (dir === 'right') return a === len && b === len;
    if (el.tagName !== 'TEXTAREA') return true;
    if (dir === 'up') return el.value.lastIndexOf('\n', a - 1) === -1;
    return el.value.indexOf('\n', b) === -1;
  }
  $('#content').addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const el = e.target;
    if (!el.matches || !el.matches(NAV_SEL)) return;
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    let dir = map[e.key];
    // Enter ở ô nhập (không phải ô ghi chú / nút) = xuống ô dưới, Shift+Enter = lên
    if (e.key === 'Enter' && el.tagName === 'INPUT') dir = e.shiftKey ? 'up' : 'down';
    if (!dir) return;
    if (e.shiftKey && e.key !== 'Enter') return;           // Shift+mũi tên: để chọn chữ
    if (el.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
    if (!caretAllows(el, dir)) return;
    if (moveFrom(el, dir)) e.preventDefault();
    else if (e.key === 'Enter') e.preventDefault();
  });

  // Ctrl+Z hoàn tác, Ctrl+Y / Ctrl+Shift+Z làm lại (Cmd trên Mac)
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    const t = e.target;
    // ô ghi chú và các ô ngoài bảng (thêm HS, hộp thoại): để trình duyệt tự hoàn tác chữ
    if (t.tagName === 'TEXTAREA' || (t.matches && t.matches('input, select') && !$('#content').contains(t))) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (k === 'y' || e.shiftKey) doRedo(); else doUndo();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'newClassName') { e.preventDefault(); addClass(); return; }
    if (e.key === 'Enter' && e.target.id === 'newStudent') {
      e.preventDefault();
      $('#addStudent').click();
    }
  });

  $('#bulkDialog').addEventListener('close', () => {
    if ($('#bulkDialog').returnValue === 'ok') addStudents($('#bulkNames').value.split(/\r?\n/));
  });
  $('#colDialog').addEventListener('close', () => {
    const name = $('#colName').value.trim();
    if ($('#colDialog').returnValue === 'ok' && name) addColumn(name, $('#colType').value, pickedSessions($('#colSessions')));
  });
  $('#delColDialog').addEventListener('close', () => {
    if ($('#delColDialog').returnValue !== 'ok') return;
    const sids = pickedSessions($('#delColSessions'));
    if (!sids.length) { alert('Hãy chọn ít nhất một buổi.'); return; }
    deleteColumn($('#delColSel').value, sids);
  });

  $('#importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) restore(f);
    e.target.value = '';
  });

  $('#fontSel').addEventListener('change', e => { ui.font = e.target.value; saveUI(); applyFont(); fixHeader(); });
  $('#sizeSel').addEventListener('change', e => { ui.size = Number(e.target.value); saveUI(); applyFont(); fixHeader(); });
  window.addEventListener('resize', fixHeader);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fixHeader);

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'sessionFilter') { ui.session = t.value; saveUI(); renderContent(); return; }
    if (t.id === 'reviewMonth') { ui.reviewMonths[ui.cls] = t.value; saveUI(); renderContent(); return; }
    if (t.dataset.sdate) {
      const sh = sheetData(ui.cls, ui.sheet);
      const ses = sh.sessions.find(x => x.id === t.dataset.sdate);
      if (ses) {
        if (t.value) ses.date = t.value; else delete ses.date;
        sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['sessions'], sh.sessions);
        save();
      }
      return;
    }
    if (t.type === 'checkbox' && t.dataset.cell) { setCell(t, t.checked); return; }
    if (t.dataset.plan && (t.type === 'checkbox' || t.tagName === 'SELECT' || t.type === 'date')) setPlan(t);
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.target) {
      const sh = sheetData(ui.cls, ui.sheet);
      const v = num(t.value);
      if (v === null) delete sh.targets[t.dataset.target]; else sh.targets[t.dataset.target] = v;
      sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['targets', t.dataset.target], v === null ? undefined : v);
      save();
      const tr = t.closest('tr[data-st]');
      tr.querySelectorAll('input[data-kind="score"]').forEach(inp => {
        const [sid, key] = inp.dataset.cell.split('|');
        updateScoreCell(tr, sid, key);
      });
      return;
    }
    if (t.dataset.name) {
      const st = classData(ui.cls).students.find(s => s.id === t.dataset.name);
      if (st) { st.name = t.value; sync(COL_CLASSES, ui.cls, ['students', st.id, 'name'], st.name); save(); }
      return;
    }
    if (t.dataset.total) {
      const [sid, key] = t.dataset.total.split('|');
      const sh = sheetData(ui.cls, ui.sheet);
      if (!sh.totals[sid]) sh.totals[sid] = {};
      const v = num(t.value);
      if (v === null) delete sh.totals[sid][key]; else sh.totals[sid][key] = v;
      sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['totals', sid, key], v === null ? undefined : v);
      save();
      document.querySelectorAll('#content tbody tr[data-st]').forEach(tr => { updateScoreCell(tr, sid, key); updateRow(tr); });
      updateFooter();
      return;
    }
    if (t.dataset.rv) {
      const tr = t.closest('tr[data-st]');
      setReviewField(tr.dataset.st, reviewMonth(), t.dataset.rv, t.value);
      refreshCard(tr.dataset.st);
      return;
    }
    if (t.dataset.rvtext) {
      autoSize(t);
      const st = classData(ui.cls).students.find(s => s.id === t.dataset.rvtext);
      const auto = st ? generateComment(st, reviewMonth(), reviewItem(st.id, reviewMonth())) : '';
      setReviewField(t.dataset.rvtext, reviewMonth(), 'text', t.value === auto ? '' : t.value);
      const card = t.closest('[data-card]');
      const edited = t.value !== auto && !!t.value;
      card.querySelector('.rv-flag').hidden = !edited;
      card.querySelector('[data-rvregen]').hidden = !edited;
      return;
    }
    if (t.dataset.note) {
      const [sid, key] = t.dataset.note.split('|');
      const sh = sheetData(ui.cls, ui.sheet);
      if (!sh.notes) sh.notes = {};
      if (!sh.notes[sid]) sh.notes[sid] = {};
      if (t.value) sh.notes[sid][key] = t.value; else delete sh.notes[sid][key];
      sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['notes', sid, key], t.value || undefined);
      save();
      return;
    }
    if (t.dataset.kind === 'score') { setCell(t, num(t.value)); return; }
    if (t.dataset.cell && t.type === 'text' && !t.dataset.kind) { setCell(t, t.value === '' ? null : t.value); return; }
    if (t.dataset.plan && t.type !== 'checkbox' && t.tagName !== 'SELECT' && t.type !== 'date') setPlan(t);
  });

  function writeCell(stId, sid, key, value) {
    const sh = sheetData(ui.cls, ui.sheet);
    if (!sh.data[stId]) sh.data[stId] = {};
    if (!sh.data[stId][sid]) sh.data[stId][sid] = {};
    if (value === null || value === false) delete sh.data[stId][sid][key];
    else sh.data[stId][sid][key] = value;
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['data', stId, sid, key], value === null || value === false ? undefined : value);
    save();
  }

  function setCell(input, value) {
    const tr = input.closest('tr[data-st]');
    const [sid, key] = input.dataset.cell.split('|');
    writeCell(tr.dataset.st, sid, key, value);
    if (input.dataset.kind === 'score') updateScoreCell(tr, sid, key);
    updateRow(tr);
    updateFooter();
  }

  function setPlan(input) {
    const tr = input.closest('tr[data-row]');
    const sh = sheetData(ui.cls, ui.sheet);
    const row = sh.rows[Number(tr.dataset.row)];
    const f = input.dataset.plan;
    row[f] = input.type === 'checkbox' ? input.checked : input.value;
    if (f === 'done') tr.classList.toggle('done', input.checked);
    sync(COL_SHEETS, sheetDocId(ui.cls, ui.sheet), ['rows'], sh.rows);
    save();
  }

  renderFontControls();
  renderAll();
  baseline = clone(state);
})();
