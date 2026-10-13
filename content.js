// Injeta o painel de pastas na página github.com/<user>?tab=repositories, só no perfil
// da conta com sessão iniciada. Os repositórios são lidos da própria página (scraping) e
// partilham o armazenamento da conta com o painel lateral (ver github-session.js).
const UNSORTED = '__unsorted__';
const META_TTL = 12 * 60 * 60 * 1000; // contribuidores são revalidados a cada 12h
const META_CONCURRENCY = 4;
const FOLDER_COLORS = ['#4493f8', '#3fb950', '#a371f7', '#f0883e', '#db61a2', '#d29922', '#39c5cf', '#f85149'];

const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219', C: '#555555',
  'C++': '#f34b7d', 'C#': '#178600', HTML: '#e34c26', CSS: '#663399', SCSS: '#c6538c', Go: '#00ADD8',
  Rust: '#dea584', PHP: '#4F5D95', Ruby: '#701516', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
  Shell: '#89e051', Vue: '#41b883', Svelte: '#ff3e00', 'Jupyter Notebook': '#DA5B0B', Lua: '#000080',
  'Objective-C': '#438eff', R: '#198CE7', Assembly: '#6E4C13', Dockerfile: '#384d54', MDX: '#fcb32c',
};

// Colunas que se podem mostrar em cada repositório dentro das pastas.
// field: campo do repositório (vem da lista do perfil ou da API); source: pedido próprio.
// api: true = só existe na API pública do GitHub (60 pedidos/hora).
const PANEL_COLUMNS = [
  { id: 'description', label: 'Descrição', icon: 'file', field: 'description', inline: true },
  { id: 'language', label: 'Linguagem', icon: 'code', width: '130px', field: 'language' },
  { id: 'contributors', label: 'Contribuidores', icon: 'users', width: '110px', source: 'contributors' },
  { id: 'activity', label: 'Atividade (último ano)', icon: 'activity', width: '100px', source: 'activity' },
  { id: 'updated', label: 'Última atualização', icon: 'clock', width: '140px', field: 'updatedAt' },
  { id: 'created', label: 'Data de criação', icon: 'calendar', width: '120px', field: 'createdAt', api: true },
  { id: 'stars', label: 'Estrelas', icon: 'star', width: '60px', field: 'stars' },
  { id: 'forks', label: 'Forks', icon: 'fork', width: '60px', field: 'forks' },
  { id: 'issues', label: 'Issues e PRs abertos', icon: 'issue', width: '60px', field: 'openIssues', api: true },
  { id: 'license', label: 'Licença', icon: 'law', width: '100px', field: 'license' },
  { id: 'topics', label: 'Tópicos', icon: 'tag', width: '170px', field: 'topics' },
  { id: 'size', label: 'Tamanho', icon: 'database', width: '80px', field: 'size', api: true },
  { id: 'homepage', label: 'Website', icon: 'link', width: '32px', field: 'homepage', api: true },
];
const COLUMN_BY_ID = Object.fromEntries(PANEL_COLUMNS.map((c) => [c.id, c]));
const DEFAULT_COLUMNS = ['description', 'language', 'contributors', 'updated', 'stars'];

const state = { login: '', folders: [], repos: [], collab: [], collabCollapsed: false, meta: {}, query: '', columns: DEFAULT_COLUMNS };
let syncing = false;
let loadingCollab = false;

// ---------- Ícones (SVG inline, estilo traço) ----------

const ICONS = {
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  folder: '<path fill="currentColor" stroke="none" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6c.6 0 1.2.3 1.6.8l1 1.2h6.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6c.6 0 1.2.3 1.6.8l1 1.2h6.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  repo: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7"/><line x1="12" y1="12" x2="12" y2="17"/>',
  issue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  law: '<path d="M12 3v18"/><path d="M6 21h12"/><path d="M4 7h16"/><path d="M7 7l-3 7a3 3 0 0 0 6 0z"/><path d="M17 7l-3 7a3 3 0 0 0 6 0z"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};

function icon(name, className = '') {
  const span = document.createElement('span');
  span.className = `grf-icon ${className}`;
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

// ---------- Armazenamento ----------

async function load() {
  state.login = loggedInUser();
  const d = await Session.load(state.login, ['repoMeta', 'panelColumns']);
  state.columns = d.panelColumns || DEFAULT_COLUMNS;
  state.folders = d.folders || [];
  state.repos = d.repos || [];
  state.collab = d.collabRepos || [];
  state.collabCollapsed = !!d.collabCollapsed;
  // O que está em memória é mais recente (a gravação dos metadados é adiada).
  state.meta = { ...(d.repoMeta || {}), ...state.meta };
}

function save() {
  return Session.save(state.login, { folders: state.folders, collabCollapsed: state.collabCollapsed });
}

// Junta sem apagar campos já conhecidos (ex.: a API sabe a linguagem, a página não).
function mergeRepos(found) {
  const byName = new Map(state.repos.map((r) => [r.fullName.toLowerCase(), r]));
  for (const r of found) {
    const key = r.fullName.toLowerCase();
    const defined = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== null));
    byName.set(key, { ...byName.get(key), ...defined });
  }
  state.repos = [...byName.values()];
  return Session.save(state.login, { repos: state.repos });
}

function findRepo(fullName) {
  const n = fullName.toLowerCase();
  return state.repos.find((r) => r.fullName.toLowerCase() === n);
}

// ---------- Leitura da lista ----------

function profileOwner() {
  return location.pathname.split('/')[1];
}

function loggedInUser() {
  return document.querySelector('meta[name="user-login"]')?.content || '';
}

function isOwnProfile() {
  const me = loggedInUser().toLowerCase();
  return !!me && me === profileOwner().toLowerCase();
}

// Percorre todas as páginas da lista (?page=N) e guarda os repositórios.
async function syncAllPages() {
  if (syncing) return;
  syncing = true;
  setStatus('A ler todas as páginas…');
  try {
    const found = await Session.fetchOwnRepos(state.login, (n) => setStatus(`A ler todas as páginas… ${n} repositórios`));
    await mergeRepos(found);
    setStatus(`${found.length} repositórios sincronizados.`);
    setTimeout(() => setStatus(''), 2500);
  } catch (err) {
    setStatus(`Falhou a sincronização: ${err.message}`, true);
  } finally {
    syncing = false;
  }
}

// ---------- Repositórios onde és colaborador ----------
// A página do perfil só mostra os repositórios de que és dono; os de colaboração
// vêm de github.com/settings/repositories.

async function refreshCollaborations() {
  if (loadingCollab) return;
  loadingCollab = true;
  try {
    const found = await Session.fetchCollabRepos(state.login);
    await mergeRepos(found);
    state.collab = found.map((r) => r.fullName);
    await Session.save(state.login, { collabRepos: state.collab });
    scheduleRender();
  } catch (err) {
    setStatus(`Não consegui obter as colaborações (${err.message}).`, true);
  } finally {
    loadingCollab = false;
  }
}

// ---------- Metadados (carregados só para as colunas visíveis) ----------
// contributors: fragmento HTML da barra lateral do repositório (usa a sessão, funciona em privados)
// activity:     gráfico de commits do último ano (/graphs/participation, também com a sessão)
// info:         API do GitHub via background (data de criação, issues, tamanho, website…)

const DATA_CONCURRENCY = 4;
const dataTasks = new Map();
const dataWaiting = [];
let dataActive = 0;
let metaSaveTimer = null;

function metaOf(fullName) {
  return state.meta[fullName.toLowerCase()];
}

function isFresh(time) {
  return !!time && Date.now() - time < META_TTL;
}

function updateMeta(fullName, patch) {
  const key = fullName.toLowerCase();
  state.meta[key] = { ...state.meta[key], ...patch };
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => chrome.storage.local.set({ repoMeta: state.meta }), 400);
  scheduleRender();
}

// Corre fn uma única vez por chave, com no máximo DATA_CONCURRENCY pedidos em simultâneo.
function runTask(key, fn) {
  if (dataTasks.has(key)) return dataTasks.get(key);
  const promise = new Promise((resolve) => {
    dataWaiting.push(() => fn().then(resolve, resolve));
    pumpTasks();
  }).finally(() => dataTasks.delete(key));
  dataTasks.set(key, promise);
  return promise;
}

function pumpTasks() {
  while (dataActive < DATA_CONCURRENCY && dataWaiting.length) {
    const job = dataWaiting.shift();
    dataActive++;
    job().finally(() => {
      dataActive--;
      pumpTasks();
    });
  }
}

async function fetchFragment(path) {
  const res = await fetch(path, { credentials: 'include', headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  return new DOMParser().parseFromString(await res.text(), 'text/html');
}

async function fetchContributors(fullName) {
  const name = fullName.split('/')[1];
  const doc = await fetchFragment(`/${fullName}/contributors_list?count=6&current_repository=${encodeURIComponent(name)}&deferred=true`);
  const avatars = [...doc.querySelectorAll('img.avatar')].map((img) => ({
    login: (img.getAttribute('alt') || '').replace(/^@/, ''),
    src: img.getAttribute('src'),
  }));
  const counter = doc.querySelector('.Counter');
  return {
    contributors: counter ? counter.getAttribute('title') || counter.textContent.trim() : String(avatars.length),
    avatars: avatars.slice(0, 4),
  };
}

// Alturas (0–28) das ~52 semanas do gráfico de participação do GitHub.
async function fetchActivity(fullName) {
  const doc = await fetchFragment(`/${fullName}/graphs/participation?h=28&type=sparkline&w=155`);
  const points = doc.querySelector('polyline')?.getAttribute('points') || '';
  return points.trim().split(/\s+/).map((p) => Number(p.split(',')[1])).filter((n) => !Number.isNaN(n));
}

// Cada tipo de dado grava um carimbo de tempo, mesmo quando falha, para não repetir pedidos.
const FETCHERS = {
  contributors: { stamp: 'fetchedAt', run: async (n) => updateMeta(n, await fetchContributors(n)) },
  activity: { stamp: 'activityAt', run: async (n) => updateMeta(n, { activity: await fetchActivity(n) }) },
  info: {
    stamp: 'infoAt',
    run: async (n) => {
      const { repo } = await ask({ type: 'fetchRepoInfo', fullName: n });
      await mergeRepos([repo]);
    },
  },
};

function ensureData(fullName, kind) {
  const fetcher = FETCHERS[kind];
  if (isFresh(metaOf(fullName)?.[fetcher.stamp])) return null;
  return runTask(`${kind}:${fullName.toLowerCase()}`, async () => {
    try {
      await fetcher.run(fullName);
    } catch {
      // sem acesso, repo vazio ou limite da API — a coluna mostra "—"
    } finally {
      updateMeta(fullName, { [fetcher.stamp]: Date.now() });
    }
  });
}

// Pede só o que as colunas indicadas precisam e ainda não se sabe.
function ensureRepoData(fullName, columnIds) {
  const repo = findRepo(fullName);
  const kinds = new Set(repo?.updatedAt ? [] : ['info']); // colaborações: nem a data se sabe
  for (const id of columnIds) {
    const col = COLUMN_BY_ID[id];
    if (col?.source) kinds.add(col.source);
    else if (col?.field && repo?.[col.field] === undefined) kinds.add('info');
  }
  return Promise.all([...kinds].map((k) => ensureData(fullName, k)));
}

// ---------- Pastas ----------

function folderOf(fullName) {
  const n = fullName.toLowerCase();
  return state.folders.find((f) => f.repos.some((r) => r.toLowerCase() === n));
}

function folderColor(folder) {
  if (folder.color) return folder.color;
  const i = state.folders.indexOf(folder);
  return FOLDER_COLORS[(i < 0 ? 0 : i) % FOLDER_COLORS.length];
}

function moveRepo(fullName, folderId) {
  const n = fullName.toLowerCase();
  for (const f of state.folders) f.repos = f.repos.filter((r) => r.toLowerCase() !== n);
  state.folders.find((f) => f.id === folderId)?.repos.push(fullName);
  save();
  render();
}

function createFolder(parentId = null) {
  const folder = {
    id: crypto.randomUUID(),
    name: parentId ? 'Nova subpasta' : 'Nova pasta',
    collapsed: false,
    repos: [],
    parentId,
    color: FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length],
  };
  state.folders.push(folder);
  const parent = FolderTree.byId(state.folders, parentId);
  if (parent) parent.collapsed = false;
  save();
  render();
  startRename(folder.id);
}

function moveFolder(id, parentId) {
  if (!FolderTree.setParent(state.folders, id, parentId)) return;
  const parent = FolderTree.byId(state.folders, parentId);
  if (parent) parent.collapsed = false;
  save();
  render();
}

function deleteFolder(id) {
  state.folders = FolderTree.remove(state.folders, id);
  save();
  render();
}

function cycleColor(folder) {
  const i = FOLDER_COLORS.indexOf(folderColor(folder));
  folder.color = FOLDER_COLORS[(i + 1) % FOLDER_COLORS.length];
  save();
  render();
}

function startRename(id) {
  const folder = state.folders.find((f) => f.id === id);
  const nameEl = document.querySelector(`#grf-panel .grf-folder[data-id="${id}"] > .grf-folder-head .grf-folder-name`);
  if (!folder || !nameEl) return;
  const head = nameEl.closest('.grf-folder-head');
  head.draggable = false; // senão o input não deixa selecionar texto
  const input = el('input', { className: 'grf-rename', value: folder.name });
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) folder.name = input.value.trim();
    input.remove(); // tem de sair antes do render, que ignora pedidos durante a edição
    save();
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// ---------- Utilitários de UI ----------

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function iconButton(name, title, onClick, extraClass = '') {
  const btn = el('button', { className: `grf-icon-btn ${extraClass}`, type: 'button', title }, icon(name));
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function setStatus(text, isError = false) {
  const s = document.querySelector('#grf-panel .grf-status');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('grf-error', isError);
}

const rtf = new Intl.RelativeTimeFormat('pt', { numeric: 'auto' });
const TIME_UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

function timeAgo(iso) {
  const secs = (new Date(iso) - Date.now()) / 1000;
  for (const [unit, size] of TIME_UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return 'agora mesmo';
}

function languageColor(repo) {
  return repo?.languageColor || LANGUAGE_COLORS[repo?.language] || '#8b949e';
}

function matches(fullName) {
  if (!state.query) return true;
  const repo = findRepo(fullName);
  return `${fullName} ${repo?.description || ''} ${repo?.language || ''}`.toLowerCase().includes(state.query);
}

// Um <select> nativo invisível por cima de um botão: acessível e sem dropdown próprio.
function moveSelect(fullName, currentId, label) {
  const select = el('select', { className: 'grf-move-select', title: 'Mover para pasta' });
  select.append(new Option('Mover para…', '', true, true));
  select.options[0].disabled = true;
  for (const { folder, depth } of FolderTree.flatten(state.folders)) {
    const opt = new Option(FolderTree.optionLabel(folder, depth), folder.id);
    opt.disabled = folder.id === currentId;
    select.append(opt);
  }
  if (currentId !== UNSORTED) select.append(new Option('— Tirar da pasta —', UNSORTED));
  select.addEventListener('change', () => moveRepo(fullName, select.value));
  select.addEventListener('mousedown', (e) => e.stopPropagation());
  return el('span', { className: `grf-move${label ? ' grf-move-labeled' : ''}` },
    icon(label ? 'folderPlus' : 'more'), label ? el('span', { textContent: label }) : null, select);
}

function makeDraggable(node, value, type = 'text/x-repo') {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.setData(type, value);
    e.dataTransfer.effectAllowed = 'move';
    node.classList.add('grf-dragging');
    document.getElementById('grf-panel')?.classList.add('grf-is-dragging');
  });
  node.addEventListener('dragend', () => {
    node.classList.remove('grf-dragging');
    document.getElementById('grf-panel')?.classList.remove('grf-is-dragging');
  });
}

// Aceita repositórios (move-os para a pasta) e pastas (passam a subpasta).
// folderId UNSORTED = topo do painel: repos ficam sem pasta, pastas passam a topo.
function makeDropTarget(node, folderId) {
  const accepts = (e) => e.dataTransfer.types.includes('text/x-repo') || e.dataTransfer.types.includes('text/x-folder');
  node.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation(); // só a pasta mais interior fica realçada
    document.querySelectorAll('.grf-drop').forEach((n) => n !== node && n.classList.remove('grf-drop'));
    node.classList.add('grf-drop');
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget)) node.classList.remove('grf-drop');
  });
  node.addEventListener('drop', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove('grf-drop');
    document.getElementById('grf-panel')?.classList.remove('grf-is-dragging');
    const fullName = e.dataTransfer.getData('text/x-repo');
    const draggedFolder = e.dataTransfer.getData('text/x-folder');
    if (fullName) moveRepo(fullName, folderId);
    else if (draggedFolder) moveFolder(draggedFolder, folderId === UNSORTED ? null : folderId);
  });
}

// ---------- Renderização ----------

const dateFormat = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' });

function formatSize(kb) {
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1).replace('.0', '')} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

function sparkline(values, color) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 24');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('grf-spark');
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${23 - (v / max) * 21}`);
  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute('points', `0,24 ${pts.join(' ')} 100,24`);
  area.setAttribute('fill', color);
  area.setAttribute('opacity', '.18');
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.6');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(area, line);
  return svg;
}

// Conteúdo de cada coluna. Devolve null quando o dado não existe (mostra "—").
const CELL_RENDERERS = {
  language: (repo) => {
    if (!repo.language) return null;
    const dot = el('i', { className: 'grf-lang-dot' });
    dot.style.background = languageColor(repo);
    return [dot, el('span', { textContent: repo.language })];
  },
  contributors: (repo, meta) => {
    if (meta?.contributors === undefined) return null;
    const stack = el('span', { className: 'grf-avatars' },
      ...(meta.avatars || []).map((a) => el('img', { src: a.src, alt: a.login, title: a.login, loading: 'lazy' })));
    return [stack, el('span', { textContent: meta.contributors })];
  },
  activity: (repo, meta, color) => (meta?.activity?.length ? [sparkline(meta.activity, color)] : null),
  updated: (repo) => (repo.updatedAt ? [icon('clock'), el('span', { textContent: timeAgo(repo.updatedAt), title: new Date(repo.updatedAt).toLocaleString('pt-PT') })] : null),
  created: (repo) => (repo.createdAt ? [icon('calendar'), el('span', { textContent: dateFormat.format(new Date(repo.createdAt)) })] : null),
  stars: (repo) => [icon('star'), el('span', { textContent: repo.stars })],
  forks: (repo) => [icon('fork'), el('span', { textContent: repo.forks })],
  issues: (repo) => [icon('issue'), el('span', { textContent: repo.openIssues })],
  license: (repo) => (repo.license ? [icon('law'), el('span', { textContent: repo.license })] : null),
  topics: (repo) => (repo.topics?.length
    ? [el('span', { className: 'grf-topics' }, ...repo.topics.slice(0, 3).map((t) => el('span', { className: 'grf-topic', textContent: t })),
      repo.topics.length > 3 ? el('span', { className: 'grf-faint', textContent: `+${repo.topics.length - 3}` }) : null)]
    : null),
  size: (repo) => (repo.size !== undefined ? [icon('database'), el('span', { textContent: formatSize(repo.size) })] : null),
  homepage: (repo) => {
    if (!repo.homepage) return null;
    const url = /^https?:\/\//.test(repo.homepage) ? repo.homepage : `https://${repo.homepage}`;
    return [el('a', { className: 'grf-homepage', href: url, target: '_blank', rel: 'noopener', title: repo.homepage }, icon('link'))];
  },
};

// Ainda à espera do pedido que traz este dado?
function isLoading(col, repo, meta) {
  if (col.source === 'contributors') return !meta?.fetchedAt;
  if (col.source === 'activity') return !meta?.activityAt;
  return repo?.[col.field] === undefined && !meta?.infoAt;
}

function renderRepoRow(fullName, folderId, color) {
  ensureRepoData(fullName, state.columns);
  const repo = findRepo(fullName) || { fullName };
  const meta = metaOf(fullName);
  const [o, n] = fullName.split('/');

  const link = el('a', { href: `/${fullName}`, className: 'grf-repo-name' });
  if (o.toLowerCase() !== profileOwner().toLowerCase()) link.append(el('span', { className: 'grf-owner', textContent: `${o}/` }));
  link.append(n);

  const title = el('div', { className: 'grf-repo-title' },
    icon(repo.private ? 'lock' : 'repo', 'grf-repo-icon'),
    link,
    repo.private ? el('span', { className: 'grf-pill', textContent: 'Private' }) : null,
    repo.fork ? el('span', { className: 'grf-pill', textContent: 'Fork' }) : null,
    repo.archived ? el('span', { className: 'grf-pill grf-pill-warn', textContent: 'Archived' }) : null);

  const showDescription = state.columns.includes('description') && repo.description;
  const main = el('div', { className: 'grf-repo-main' }, title,
    showDescription ? el('div', { className: 'grf-repo-desc', textContent: repo.description, title: repo.description }) : null);

  const cells = visibleColumns().map((col) => {
    const cell = el('span', { className: `grf-meta grf-meta-${col.id}`, title: col.label });
    cell.style.flexBasis = col.width; // usado quando a linha passa a flex (muitas colunas / ecrã estreito)
    const content = CELL_RENDERERS[col.id](repo, meta, color);
    if (content) cell.append(...content);
    else if (isLoading(col, repo, meta)) cell.append(el('span', { className: 'grf-skeleton' }));
    else cell.append(el('span', { className: 'grf-faint', textContent: '—' }));
    return cell;
  });

  const row = el('li', { className: 'grf-repo' }, main, ...cells, moveSelect(fullName, folderId));
  makeDraggable(row, fullName);
  return row;
}

// Colunas com largura própria (a descrição vai por baixo do nome).
function visibleColumns() {
  return PANEL_COLUMNS.filter((c) => !c.inline && state.columns.includes(c.id));
}

function setColumns(ids) {
  state.columns = PANEL_COLUMNS.map((c) => c.id).filter((id) => ids.includes(id)); // mantém a ordem do catálogo
  chrome.storage.local.set({ panelColumns: state.columns });
  render();
}

// Menu "Colunas": liga/desliga cada coluna.
function buildColumnsMenu() {
  const btn = el('button', { className: 'grf-btn', type: 'button', title: 'Escolher que informação aparece em cada repositório' },
    icon('columns'), el('span', { textContent: 'Colunas' }));
  const menu = el('div', { className: 'grf-menu', hidden: true });
  const wrap = el('div', { className: 'grf-menu-wrap' }, btn, menu);

  const fill = () => {
    const items = PANEL_COLUMNS.map((col) => {
      const box = el('input', { type: 'checkbox', checked: state.columns.includes(col.id) });
      box.addEventListener('change', () => {
        setColumns(box.checked ? [...state.columns, col.id] : state.columns.filter((id) => id !== col.id));
      });
      return el('label', { className: 'grf-menu-item' }, box, icon(col.icon), el('span', { textContent: col.label }),
        col.api ? el('span', { className: 'grf-menu-tag', textContent: 'API', title: 'Vem da API pública do GitHub (60 pedidos por hora).' }) : null);
    });
    const reset = el('button', { className: 'grf-menu-reset', type: 'button', textContent: 'Repor predefinição' });
    reset.addEventListener('click', () => {
      setColumns(DEFAULT_COLUMNS);
      fill();
    });
    menu.replaceChildren(el('div', { className: 'grf-menu-title', textContent: 'Colunas visíveis' }), ...items, reset);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (!menu.hidden) fill();
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) menu.hidden = true;
  });
  return wrap;
}

// Barra fina com a distribuição de linguagens dentro da pasta.
function languageBar(repoNames) {
  const counts = new Map();
  for (const n of repoNames) {
    const repo = findRepo(n);
    if (!repo?.language) continue;
    const c = counts.get(repo.language) || { count: 0, color: languageColor(repo) };
    c.count++;
    counts.set(repo.language, c);
  }
  if (counts.size === 0) return null;
  const total = [...counts.values()].reduce((s, c) => s + c.count, 0);
  const bar = el('div', { className: 'grf-langbar' });
  bar.title = [...counts].map(([lang, c]) => `${lang} ${Math.round((c.count / total) * 100)}%`).join(' · ');
  for (const [, c] of [...counts].sort((a, b) => b[1].count - a[1].count)) {
    const seg = el('i');
    seg.style.flexGrow = c.count;
    seg.style.background = c.color;
    bar.append(seg);
  }
  return bar;
}

function latestUpdate(repoNames) {
  const dates = repoNames.map((n) => findRepo(n)?.updatedAt).filter(Boolean).sort();
  return dates.at(-1);
}

function folderHead({ toggleCollapsed, collapsed, iconNode, nameNode, total, repoNames, actions }) {
  const chevron = el('button', { className: `grf-chevron${collapsed ? '' : ' grf-open'}`, type: 'button', title: 'Expandir/recolher' }, icon('chevron'));
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCollapsed();
  });
  const latest = latestUpdate(repoNames);
  const summary = el('span', { className: 'grf-folder-summary' },
    el('span', { className: 'grf-count', textContent: `${total} repo${total === 1 ? '' : 's'}` }),
    latest ? el('span', { className: 'grf-folder-updated', textContent: `atualizado ${timeAgo(latest)}` }) : null);
  const head = el('div', { className: 'grf-folder-head' }, chevron, iconNode, nameNode, summary,
    actions ? el('span', { className: 'grf-actions' }, ...actions) : null);
  head.addEventListener('click', (e) => {
    if (e.target.closest('button, input, select, a')) return;
    toggleCollapsed();
  });
  return head;
}

function renderFolder(folder) {
  const allNames = FolderTree.allRepos(state.folders, folder);
  const searching = !!state.query;
  if (searching && !allNames.some(matches)) return null;
  const collapsed = folder.collapsed && !searching;

  const folderIcon = el('button', { className: 'grf-folder-icon', type: 'button', title: 'Mudar cor' }, icon('folder'));
  folderIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleColor(folder);
  });
  const name = el('span', { className: 'grf-folder-name', textContent: folder.name, title: 'Duplo clique para mudar o nome' });
  name.addEventListener('dblclick', () => startRename(folder.id));

  const head = folderHead({
    toggleCollapsed: () => {
      folder.collapsed = !folder.collapsed;
      save();
      render();
    },
    collapsed,
    iconNode: folderIcon,
    nameNode: name,
    total: allNames.length,
    repoNames: allNames,
    actions: [
      iconButton('folderPlus', 'Nova subpasta', () => createFolder(folder.id)),
      iconButton('edit', 'Mudar nome', () => startRename(folder.id)),
      iconButton('droplet', 'Mudar cor', () => cycleColor(folder)),
      iconButton('trash', 'Apagar pasta (o conteúdo sobe para a pasta-mãe)', () => deleteFolder(folder.id), 'grf-danger'),
    ],
  });
  makeDraggable(head, folder.id, 'text/x-folder');

  const body = el('div', { className: 'grf-folder-body' });
  if (!collapsed) {
    const subfolders = FolderTree.children(state.folders, folder.id).map(renderFolder).filter(Boolean);
    if (subfolders.length) body.append(el('div', { className: 'grf-children' }, ...subfolders));
    const visible = folder.repos.filter(matches);
    if (visible.length) body.append(el('ul', { className: 'grf-repos' }, ...visible.map((n) => renderRepoRow(n, folder.id, folderColor(folder)))));
    if (folder.repos.length === 0 && subfolders.length === 0) {
      body.append(el('div', { className: 'grf-dropzone', textContent: 'Arrasta repositórios ou pastas para aqui' }));
    }
  }

  const node = el('section', { className: `grf-folder${collapsed ? ' grf-collapsed' : ''}` }, head, languageBar(allNames), body);
  node.dataset.id = folder.id;
  node.style.setProperty('--grf-folder-color', folderColor(folder));
  makeDropTarget(node, folder.id);
  return node;
}

// Secção com as colaborações que ainda não estão em nenhuma pasta.
function renderCollab() {
  const pending = state.collab.filter((n) => !folderOf(n));
  const visible = pending.filter(matches);
  if (visible.length === 0) return null;
  const collapsed = state.collabCollapsed && !state.query;
  const head = folderHead({
    toggleCollapsed: () => {
      state.collabCollapsed = !state.collabCollapsed;
      save();
      render();
    },
    collapsed,
    iconNode: el('span', { className: 'grf-folder-icon' }, icon('users')),
    nameNode: el('span', { className: 'grf-folder-name', textContent: 'Colaborações sem pasta' }),
    total: pending.length,
    repoNames: pending,
  });
  const body = el('div', { className: 'grf-folder-body' });
  if (!collapsed) body.append(el('ul', { className: 'grf-repos' }, ...visible.map((n) => renderRepoRow(n, UNSORTED, '#8b949e'))));
  const node = el('section', { className: `grf-folder grf-collab${collapsed ? ' grf-collapsed' : ''}` }, head, body);
  node.style.setProperty('--grf-folder-color', '#8b949e');
  return node;
}

function buildPanel(list) {
  const search = el('input', { type: 'search', className: 'grf-search-input', placeholder: 'Procurar nas pastas…' });
  search.addEventListener('input', () => {
    state.query = search.value.trim().toLowerCase();
    render();
  });
  const syncBtn = el('button', { className: 'grf-btn', type: 'button', title: 'Lê todas as páginas da lista, as colaborações e os contribuidores' },
    icon('refresh'), el('span', { textContent: 'Sincronizar' }));
  syncBtn.addEventListener('click', () => {
    state.meta = {}; // força também a atualização de contribuidores, atividade e dados da API
    chrome.storage.local.set({ repoMeta: {} });
    syncAllPages();
    refreshCollaborations();
    render();
  });
  const readmeBtn = el('button', { className: 'grf-btn grf-readme-btn', type: 'button', title: 'Escrever as pastas no README do teu perfil' },
    icon('file'), el('span', { textContent: 'README' }));
  readmeBtn.addEventListener('click', openReadmeDialog);
  const newBtn = el('button', { className: 'grf-btn grf-btn-primary', type: 'button' }, icon('plus'), el('span', { textContent: 'Nova pasta' }));
  newBtn.addEventListener('click', () => createFolder());

  const panel = el('div', { id: 'grf-panel' },
    el('div', { className: 'grf-header' },
      el('div', { className: 'grf-title' },
        el('span', { className: 'grf-title-icon' }, icon('folder')),
        el('div', {},
          el('div', { className: 'grf-title-text', textContent: 'Pastas' }),
          el('div', { className: 'grf-subtitle' }))),
      el('div', { className: 'grf-toolbar' },
        el('label', { className: 'grf-search' }, icon('search'), search),
        buildColumnsMenu(), syncBtn, readmeBtn, newBtn)),
    el('div', { className: 'grf-status' }),
    el('div', { className: 'grf-folders' }));
  makeDropTarget(panel.querySelector('.grf-folders'), UNSORTED);
  list.before(panel);
  return panel;
}

function renderPanel() {
  const list = document.getElementById('user-repositories-list');
  if (!list) return;
  const panel = document.getElementById('grf-panel') || buildPanel(list);

  const organized = state.folders.reduce((s, f) => s + f.repos.length, 0);
  const nf = state.folders.length;
  panel.querySelector('.grf-subtitle').textContent =
    `${nf} pasta${nf === 1 ? '' : 's'} · ${organized} repositório${organized === 1 ? '' : 's'} organizado${organized === 1 ? '' : 's'}`;

  // Poucas colunas: tudo numa linha. Muitas: o nome fica em cima e os dados numa segunda linha.
  const cols = visibleColumns();
  const widths = cols.map((c) => c.width).join(' ');
  const total = cols.reduce((sum, c) => sum + parseInt(c.width, 10), 0);
  const wide = total > 520;
  panel.classList.toggle('grf-wide', wide);
  panel.style.setProperty('--grf-cols', `minmax(0, 1fr) ${widths} 30px`);
  panel.querySelector('.grf-readme-btn').hidden = state.folders.length === 0;

  const container = panel.querySelector('.grf-folders');
  const nodes = FolderTree.children(state.folders).map(renderFolder);
  nodes.push(renderCollab());
  container.replaceChildren(...nodes.filter(Boolean));

  if (nf === 0) {
    container.prepend(el('div', { className: 'grf-empty' },
      el('span', { className: 'grf-empty-icon' }, icon('folderPlus')),
      el('strong', { textContent: 'Ainda não tens pastas' }),
      el('span', { textContent: 'Cria uma pasta e arrasta repositórios da lista abaixo para dentro dela.' })));
  } else if (state.query && !container.children.length) {
    container.append(el('div', { className: 'grf-empty' }, el('span', { textContent: 'Nada encontrado nas pastas.' })));
  }
}

// ---------- README do perfil ----------
// Gera a secção a partir das pastas para copiar e colar no README de <user>/<user>.

async function ask(message) {
  const res = await chrome.runtime.sendMessage(message);
  if (res?.error) throw new Error(res.error);
  return res;
}

async function openReadmeDialog() {
  const owner = loggedInUser();
  const { readmeOptions = {} } = await chrome.storage.local.get('readmeOptions');
  let includePrivate = !!readmeOptions.includePrivate;
  let columns = readmeOptions.columns || ProfileReadme.DEFAULT_COLUMNS;
  const saveOptions = () => chrome.storage.local.set({ readmeOptions: { includePrivate, columns } });

  const chips = ProfileReadme.COLUMNS.map((col) => {
    const box = el('input', { type: 'checkbox', checked: columns.includes(col.id) });
    box.addEventListener('change', () => {
      const ids = box.checked ? [...columns, col.id] : columns.filter((id) => id !== col.id);
      columns = ProfileReadme.COLUMNS.map((c) => c.id).filter((id) => ids.includes(id));
      saveOptions();
      refresh();
    });
    return el('label', { className: 'grf-chip-toggle' }, box, el('span', { textContent: col.label }));
  });
  let section = '';

  const privateBox = el('input', { type: 'checkbox', checked: includePrivate });
  const preview = el('div', { className: 'grf-readme-preview markdown-body' });
  const source = el('pre', { className: 'grf-readme-source', hidden: true });
  const note = el('div', { className: 'grf-readme-note' });
  const status = el('span', { className: 'grf-readme-status' });
  const openRepo = el('a', { className: 'grf-btn', href: `/${owner}/${owner}`, target: '_blank', textContent: 'Abrir repositório do README' });
  const copy = el('button', { className: 'grf-btn grf-btn-primary', type: 'button' }, icon('copy'), el('span', { textContent: 'Copiar Markdown' }));

  const tabPreview = el('button', { className: 'grf-tab grf-tab-active', type: 'button', textContent: 'Pré-visualização' });
  const tabSource = el('button', { className: 'grf-tab', type: 'button', textContent: 'Markdown' });
  const showTab = (isPreview) => {
    tabPreview.classList.toggle('grf-tab-active', isPreview);
    tabSource.classList.toggle('grf-tab-active', !isPreview);
    preview.hidden = !isPreview;
    source.hidden = isPreview;
  };
  tabPreview.addEventListener('click', () => showTab(true));
  tabSource.addEventListener('click', () => showTab(false));

  const close = iconButton('close', 'Fechar', () => dialog.close());
  const dialog = el('dialog', { id: 'grf-readme-dialog' },
    el('div', { className: 'grf-dialog-head' },
      el('span', { className: 'grf-title-icon' }, icon('file')),
      el('div', { className: 'grf-dialog-title' },
        el('strong', { textContent: 'Secção para o README do perfil' }),
        el('span', { textContent: `${owner}/${owner} · README.md` })),
      close),
    el('div', { className: 'grf-dialog-options' },
      el('label', {}, privateBox, ' Incluir repositórios privados ',
        el('span', { className: 'grf-faint', textContent: '(quem visita o perfil não os consegue abrir)' })),
      el('span', { className: 'grf-tabs' }, tabPreview, tabSource)),
    el('div', { className: 'grf-dialog-columns' }, el('span', { className: 'grf-faint', textContent: 'Colunas:' }), ...chips),
    note,
    el('div', { className: 'grf-dialog-body' }, preview, source),
    el('div', { className: 'grf-dialog-foot' }, status, openRepo, copy));

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();

  const setNote = (text, kind = '') => {
    note.textContent = text;
    note.className = `grf-readme-note ${kind}`;
  };

  let refreshId = 0;
  const refresh = async () => {
    const id = ++refreshId;
    // Vai buscar o que falta para as colunas escolhidas (ex.: data de criação vem da API).
    const names = [...new Set(state.folders.flatMap((f) => f.repos))];
    const pending = names.map((n) => ensureRepoData(n, columns));
    status.textContent = 'A obter dados…';
    await Promise.all(pending);
    if (id !== refreshId) return; // entretanto mudaram as opções
    status.textContent = '';
    section = ProfileReadme.build(state.folders, state.repos, { owner, includePrivate, languageColor, columns, meta: state.meta });
    source.textContent = section;
    setNote('Copia e cola no README.md do repositório ' + `${owner}/${owner}` +
      '. Para atualizar mais tarde, substitui tudo o que está entre <!-- REPO-FOLDERS:START --> e <!-- REPO-FOLDERS:END -->.');

    // Pré-visualização com o motor de Markdown do GitHub.
    try {
      const { html } = await ask({ type: 'renderMarkdown', owner, text: section });
      preview.innerHTML = html; // HTML já sanitizado pela API do GitHub
    } catch {
      showTab(false);
    }
  };

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(section);
    } catch {
      // sem permissão para a área de transferência: copia a partir de uma seleção
      const area = el('textarea', { value: section });
      dialog.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    copy.querySelector('span:last-child').textContent = 'Copiado ✓';
    setTimeout(() => { copy.querySelector('span:last-child').textContent = 'Copiar Markdown'; }, 2000);
  });

  privateBox.addEventListener('change', () => {
    includePrivate = privateBox.checked;
    saveOptions();
    refresh();
  });

  refresh();
}

// Repositórios que já estão numa pasta só aparecem dentro dela (no painel);
// os restantes ficam na lista nativa com arrastar + menu de pasta.
function decorateList() {
  for (const { li, repo } of Session.parseRepoList(document)) {
    if (!li.dataset.grf) {
      li.dataset.grf = '1';
      makeDraggable(li, repo.fullName);
    }
    li.hidden = !!folderOf(repo.fullName);
    if (li.hidden) continue;

    li.querySelector('.grf-item-bar')?.remove();
    const bar = el('span', { className: 'grf-item-bar' }, moveSelect(repo.fullName, UNSORTED, 'Pasta'));
    li.querySelector('h3')?.append(bar);
  }
}

function render() {
  if (!document.getElementById('user-repositories-list') || !isOwnProfile()) return;
  if (document.querySelector('#grf-panel .grf-rename')) return; // não interromper a edição de um nome
  renderPanel();
  decorateList();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

// ---------- Arranque ----------
// O GitHub navega sem recarregar a página (Turbo), por isso observamos o DOM.

// Avisa o painel lateral de qual é a conta com sessão iniciada (troca de conta = troca de pastas).
const pageLogin = Session.loginIn(document);
const accountReady = pageLogin === null ? Promise.resolve() : Session.setAccount(pageLogin);

let lastListEl = null;
let mounted = false;

async function mountIfNeeded() {
  const list = document.getElementById('user-repositories-list');
  if (!list || list === lastListEl) return;
  lastListEl = list;
  mounted = isOwnProfile(); // só na lista de repositórios da própria conta
  if (!mounted) return;
  await accountReady;
  await load();
  render();

  const onPage = Session.parseRepoList(document).map((x) => x.repo);
  await mergeRepos(onPage);
  scheduleRender();
  const owner = profileOwner().toLowerCase();
  const knownForOwner = state.repos.filter((r) => r.fullName.toLowerCase().startsWith(`${owner}/`)).length;
  if (Session.nextPage(document) && knownForOwner <= onPage.length) syncAllPages();
  refreshCollaborations();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if ((area !== 'local' && area !== 'sync') || !mounted || !Session.changed(state.login, changes, area)) return;
  if (document.querySelector('#grf-panel .grf-rename')) return;
  await load();
  scheduleRender();
});

// A pesquisa "Find a repository" substitui os itens da lista sem trocar o contentor:
// os itens novos ainda não têm arrastar nem menu de pasta.
new MutationObserver(() => {
  mountIfNeeded();
  if (mounted && document.querySelector('#user-repositories-list li[itemprop~="owns"]:not([data-grf])')) scheduleRender();
}).observe(document.documentElement, { childList: true, subtree: true });
mountIfNeeded();
