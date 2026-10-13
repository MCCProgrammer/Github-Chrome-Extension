// Injeta o painel de pastas na página github.com/<user>?tab=repositories.
// Os repositórios são lidos da própria página (scraping) e partilham o mesmo
// armazenamento que o painel lateral (folders / repos em chrome.storage.local).
const UNSORTED = '__unsorted__';
const MAX_PAGES = 50;
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

const state = { folders: [], repos: [], collab: [], collabCollapsed: false, meta: {}, query: '' };
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
};

function icon(name, className = '') {
  const span = document.createElement('span');
  span.className = `grf-icon ${className}`;
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

// ---------- Armazenamento ----------

async function load() {
  const d = await chrome.storage.local.get(['folders', 'repos', 'collabRepos', 'collabCollapsed', 'repoMeta']);
  state.folders = d.folders || [];
  state.repos = d.repos || [];
  state.collab = d.collabRepos || [];
  state.collabCollapsed = !!d.collabCollapsed;
  // O que está em memória é mais recente (a gravação dos metadados é adiada).
  state.meta = { ...(d.repoMeta || {}), ...state.meta };
}

function save() {
  return chrome.storage.local.set({ folders: state.folders, collabCollapsed: state.collabCollapsed });
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
  return chrome.storage.local.set({ repos: state.repos });
}

function findRepo(fullName) {
  const n = fullName.toLowerCase();
  return state.repos.find((r) => r.fullName.toLowerCase() === n);
}

// ---------- Scraping da lista ----------

function parseCount(text) {
  const t = (text || '').trim().toLowerCase().replace(/,/g, '');
  const n = parseFloat(t);
  if (Number.isNaN(n)) return undefined;
  return Math.round(t.endsWith('k') ? n * 1000 : n);
}

function scrapeItems(root) {
  return [...root.querySelectorAll('#user-repositories-list li[itemprop~="owns"]')].map((li) => {
    const a = li.querySelector('a[itemprop~="codeRepository"]');
    const labels = [...li.querySelectorAll('h3 .Label')].map((l) => l.textContent.trim().toLowerCase());
    const fullName = a.getAttribute('href').replace(/^\//, '');
    return {
      li,
      repo: {
        fullName,
        description: li.querySelector('[itemprop~="description"]')?.textContent.trim() || '',
        private: labels.some((l) => l.includes('private')),
        archived: labels.some((l) => l.includes('archive')),
        fork: /forked from/i.test(li.textContent),
        language: li.querySelector('[itemprop="programmingLanguage"]')?.textContent.trim() || '',
        languageColor: li.querySelector('.repo-language-color')?.style.backgroundColor || undefined,
        updatedAt: li.querySelector('relative-time')?.getAttribute('datetime') || undefined,
        stars: parseCount(li.querySelector(`a[href="/${fullName}/stargazers"]`)?.textContent) ?? 0,
      },
    };
  });
}

function profileOwner() {
  return location.pathname.split('/')[1];
}

// Percorre todas as páginas da lista (?page=N) e guarda os repositórios.
async function syncAllPages() {
  if (syncing) return;
  syncing = true;
  setStatus('A ler todas as páginas…');
  const found = [];
  let url = `/${profileOwner()}?tab=repositories`;
  try {
    for (let i = 0; url && i < MAX_PAGES; i++) {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      found.push(...scrapeItems(doc).map((x) => x.repo));
      url = doc.querySelector('.paginate-container a[rel="next"], a.next_page')?.getAttribute('href');
      setStatus(`A ler todas as páginas… ${found.length} repositórios`);
    }
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
// A página do perfil só mostra os repositórios de que és dono. Os de colaboração vêm
// da API (se houver token no painel lateral ⚙) ou, sem token, de github.com/settings/repositories.

const RESERVED_OWNERS = new Set(['settings', 'orgs', 'organizations', 'users', 'notifications', 'marketplace',
  'features', 'enterprise', 'sponsors', 'topics', 'collections', 'explore', 'pulls', 'issues', 'codespaces',
  'login', 'logout', 'new', 'apps', 'account', 'dashboard', 'copilot', 'github-copilot', 'site', 'about',
  'pricing', 'security', 'customer-stories', 'readme', 'team', 'trending', 'search', 'contact', 'blog', 'watching', 'stars']);

function loggedInUser() {
  return document.querySelector('meta[name="user-login"]')?.content || '';
}

function isOwnProfile() {
  const me = loggedInUser().toLowerCase();
  return !!me && me === profileOwner().toLowerCase();
}

async function scrapeCollabFromSettings(me) {
  const res = await fetch('/settings/repositories', { credentials: 'include' });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const root = doc.querySelector('main') || doc.body;
  const names = new Map();
  for (const a of root.querySelectorAll('a[href]')) {
    const m = a.getAttribute('href').match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
    if (!m || RESERVED_OWNERS.has(m[1].toLowerCase()) || m[1].toLowerCase() === me.toLowerCase()) continue;
    const fullName = `${m[1]}/${m[2]}`;
    names.set(fullName.toLowerCase(), { fullName });
  }
  return [...names.values()];
}

async function refreshCollaborations() {
  if (loadingCollab || !isOwnProfile()) return;
  loadingCollab = true;
  try {
    const me = loggedInUser();
    const viaApi = await chrome.runtime.sendMessage({ type: 'fetchCollabRepos' });
    const found = viaApi?.repos
      ? viaApi.repos.filter((r) => !r.fullName.toLowerCase().startsWith(`${me.toLowerCase()}/`))
      : await scrapeCollabFromSettings(me);
    await mergeRepos(found);
    state.collab = found.map((r) => r.fullName);
    await chrome.storage.local.set({ collabRepos: state.collab });
    scheduleRender();
  } catch (err) {
    setStatus(`Não consegui obter as colaborações (${err.message}). Adiciona um token no painel lateral da extensão (⚙).`, true);
  } finally {
    loadingCollab = false;
  }
}

// ---------- Metadados: contribuidores, linguagem, última atualização ----------
// Contribuidores: fragmento HTML que o GitHub usa na barra lateral do repositório
// (funciona com a sessão, incluindo repos privados). Linguagem/data: da lista do
// perfil; para repos que lá não estão (colaborações), da API via background.

const metaQueue = [];
const metaInflight = new Set();
let metaActive = 0;
let metaSaveTimer = null;

function metaOf(fullName) {
  return state.meta[fullName.toLowerCase()];
}

function ensureMeta(fullName) {
  const key = fullName.toLowerCase();
  const m = state.meta[key];
  if ((m && Date.now() - m.fetchedAt < META_TTL) || metaInflight.has(key)) return;
  metaInflight.add(key);
  metaQueue.push(fullName);
  pumpMeta();
}

function pumpMeta() {
  while (metaActive < META_CONCURRENCY && metaQueue.length) {
    const fullName = metaQueue.shift();
    metaActive++;
    loadMeta(fullName).finally(() => {
      metaActive--;
      metaInflight.delete(fullName.toLowerCase());
      pumpMeta();
    });
  }
}

async function fetchContributors(fullName) {
  const name = fullName.split('/')[1];
  const res = await fetch(
    `/${fullName}/contributors_list?count=6&current_repository=${encodeURIComponent(name)}&deferred=true`,
    { credentials: 'include', headers: { Accept: 'text/html' } },
  );
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
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

async function loadMeta(fullName) {
  const meta = { fetchedAt: Date.now() };
  try {
    Object.assign(meta, await fetchContributors(fullName));
  } catch {
    // sem acesso ou repo vazio — fica sem contribuidores
  }
  // Repos que não vieram da lista do perfil não têm data/linguagem: pede à API.
  if (!findRepo(fullName)?.updatedAt) {
    try {
      const info = await chrome.runtime.sendMessage({ type: 'fetchRepoInfo', fullName });
      if (info?.repo) await mergeRepos([info.repo]);
    } catch {
      // limite da API sem token, ou repo privado sem token
    }
  }
  state.meta[fullName.toLowerCase()] = meta;
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => chrome.storage.local.set({ repoMeta: state.meta }), 400);
  scheduleRender();
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

function renderRepoRow(fullName, folderId) {
  ensureMeta(fullName);
  const repo = findRepo(fullName);
  const meta = metaOf(fullName);
  const [o, n] = fullName.split('/');

  const link = el('a', { href: `/${fullName}`, className: 'grf-repo-name' });
  if (o.toLowerCase() !== profileOwner().toLowerCase()) link.append(el('span', { className: 'grf-owner', textContent: `${o}/` }));
  link.append(n);

  const title = el('div', { className: 'grf-repo-title' },
    icon(repo?.private ? 'lock' : 'repo', 'grf-repo-icon'),
    link,
    repo?.private ? el('span', { className: 'grf-pill', textContent: 'Private' }) : null,
    repo?.fork ? el('span', { className: 'grf-pill', textContent: 'Fork' }) : null,
    repo?.archived ? el('span', { className: 'grf-pill grf-pill-warn', textContent: 'Archived' }) : null);

  const main = el('div', { className: 'grf-repo-main' }, title,
    repo?.description ? el('div', { className: 'grf-repo-desc', textContent: repo.description, title: repo.description }) : null);

  // Colunas de metadados (largura fixa para alinharem entre linhas).
  const lang = el('span', { className: 'grf-meta grf-meta-lang' });
  if (repo?.language) {
    const dot = el('i', { className: 'grf-lang-dot' });
    dot.style.background = languageColor(repo);
    lang.append(dot, el('span', { textContent: repo.language }));
  } else lang.append(el('span', { className: 'grf-faint', textContent: '—' }));

  const people = el('span', { className: 'grf-meta grf-meta-people' });
  if (meta?.contributors !== undefined) {
    const stack = el('span', { className: 'grf-avatars' },
      ...(meta.avatars || []).map((a) => el('img', { src: a.src, alt: a.login, title: a.login, loading: 'lazy' })));
    people.title = `${meta.contributors} contribuidor${meta.contributors === '1' ? '' : 'es'}`;
    people.append(stack, el('span', { textContent: meta.contributors }));
  } else if (meta) {
    people.append(icon('users'), el('span', { className: 'grf-faint', textContent: '—' }));
  } else {
    people.append(el('span', { className: 'grf-skeleton' }));
  }

  const updated = el('span', { className: 'grf-meta grf-meta-updated' });
  if (repo?.updatedAt) {
    updated.title = new Date(repo.updatedAt).toLocaleString('pt-PT');
    updated.append(icon('clock'), el('span', { textContent: timeAgo(repo.updatedAt) }));
  } else if (meta) {
    updated.append(icon('clock'), el('span', { className: 'grf-faint', textContent: '—' }));
  } else {
    updated.append(el('span', { className: 'grf-skeleton' }));
  }

  const stars = el('span', { className: 'grf-meta grf-meta-stars' });
  if (repo?.stars) stars.append(icon('star'), el('span', { textContent: repo.stars }));

  const row = el('li', { className: 'grf-repo' }, main, lang, people, updated, stars, moveSelect(fullName, folderId));
  makeDraggable(row, fullName);
  return row;
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
    if (visible.length) body.append(el('ul', { className: 'grf-repos' }, ...visible.map((n) => renderRepoRow(n, folder.id))));
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
  if (!collapsed) body.append(el('ul', { className: 'grf-repos' }, ...visible.map((n) => renderRepoRow(n, UNSORTED))));
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
    state.meta = {}; // força também a atualização dos contribuidores
    chrome.storage.local.set({ repoMeta: {} });
    syncAllPages();
    refreshCollaborations();
    render();
  });
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
        syncBtn, newBtn)),
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

  const container = panel.querySelector('.grf-folders');
  const nodes = FolderTree.children(state.folders).map(renderFolder);
  if (isOwnProfile()) nodes.push(renderCollab());
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

// Repositórios que já estão numa pasta só aparecem dentro dela (no painel);
// os restantes ficam na lista nativa com arrastar + menu de pasta.
function decorateList() {
  for (const { li, repo } of scrapeItems(document)) {
    li.hidden = !!folderOf(repo.fullName);
    if (li.hidden) continue;

    if (!li.dataset.grf) {
      li.dataset.grf = '1';
      makeDraggable(li, repo.fullName);
    }
    li.querySelector('.grf-item-bar')?.remove();
    const bar = el('span', { className: 'grf-item-bar' }, moveSelect(repo.fullName, UNSORTED, 'Pasta'));
    li.querySelector('h3')?.append(bar);
  }
}

function render() {
  if (!document.getElementById('user-repositories-list')) return;
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

let lastListEl = null;

async function mountIfNeeded() {
  const list = document.getElementById('user-repositories-list');
  if (!list || list === lastListEl) return;
  lastListEl = list;
  await load();
  render();

  const onPage = scrapeItems(document).map((x) => x.repo);
  await mergeRepos(onPage);
  scheduleRender();
  const owner = profileOwner().toLowerCase();
  const hasMorePages = document.querySelector('.paginate-container a[rel="next"], a.next_page');
  const knownForOwner = state.repos.filter((r) => r.fullName.toLowerCase().startsWith(`${owner}/`)).length;
  if (hasMorePages && knownForOwner <= onPage.length) syncAllPages();
  refreshCollaborations();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !['folders', 'repos', 'collabRepos'].some((k) => k in changes)) return;
  if (document.querySelector('#grf-panel .grf-rename')) return;
  await load();
  scheduleRender();
});

new MutationObserver(() => mountIfNeeded()).observe(document.documentElement, { childList: true, subtree: true });
mountIfNeeded();
