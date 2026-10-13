// State in chrome.storage.local, per account (see github-session.js) and shared
// with the GitHub page (content.js):
//   account:            login signed in on github.com ('' = signed out)
//   folders@<login>:    [{ id, name, collapsed, repos: ["owner/name", ...], parentId, color }]
//   repos@<login>:      cache of repositories read from GitHub's pages
//   unsortedCollapsed@<login>: boolean
const UNSORTED = '__unsorted__';
const FOLDER_COLORS = ['#4493f8', '#3fb950', '#a371f7', '#f0883e', '#db61a2', '#d29922', '#39c5cf', '#f85149'];
const LANGUAGE_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219', C: '#555555',
  'C++': '#f34b7d', 'C#': '#178600', HTML: '#e34c26', CSS: '#663399', SCSS: '#c6538c', Go: '#00ADD8',
  Rust: '#dea584', PHP: '#4F5D95', Ruby: '#701516', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
  Shell: '#89e051', Vue: '#41b883', Svelte: '#ff3e00', 'Jupyter Notebook': '#DA5B0B', Lua: '#000080',
  'Objective-C': '#438eff', R: '#198CE7', Assembly: '#6E4C13', Dockerfile: '#384d54', MDX: '#fcb32c',
};

const state = {
  login: null, // null = still detecting
  folders: [],
  repos: [],
  unsortedCollapsed: false,
  query: '',
  currentRepo: null,
};

const $ = (id) => document.getElementById(id);

// ---------- Icons (same strokes as the in-page panel) ----------

const ICONS = {
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  folder: '<path fill="currentColor" stroke="none" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6c.6 0 1.2.3 1.6.8l1 1.2h6.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6c.6 0 1.2.3 1.6.8l1 1.2h6.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  repo: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7"/><line x1="12" y1="12" x2="12" y2="17"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function iconButton(name, title, onClick, extraClass = '') {
  const btn = el('button', { className: `btn-icon btn-sm ${extraClass}`, type: 'button', title }, icon(name));
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// ---------- Storage ----------

async function load() {
  const { account } = await chrome.storage.local.get('account');
  state.login = account ?? null;
  const data = state.login ? await Session.load(state.login) : {};
  Object.assign(state, {
    folders: data.folders || [],
    repos: data.repos || [],
    unsortedCollapsed: !!data.unsortedCollapsed,
    syncedAt: data.syncedAt,
  });
}

function save() {
  return Session.save(state.login, {
    folders: state.folders,
    unsortedCollapsed: state.unsortedCollapsed,
  });
}

function findRepo(fullName) {
  const n = fullName.toLowerCase();
  return state.repos.find((r) => r.fullName.toLowerCase() === n);
}

// Merge without dropping known fields (the profile page may know more than the API and vice versa).
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

// ---------- Account and repositories (read from github.com with the session) ----------

// Checks github.com for the signed-in account; if it changed, loads that account's folders.
async function detectAccount() {
  let login;
  try {
    login = await Session.detectLogin();
  } catch {
    if (state.login === null) setStatus("Couldn't reach GitHub.", true);
    return;
  }
  await Session.setAccount(login); // the storage listener handles the switch
  if (login === state.login && login && Session.isStale(state.syncedAt)) fetchRepos();
}

let fetching = false;
async function fetchRepos() {
  if (!state.login || fetching) return;
  fetching = true;
  const login = state.login;
  setStatus('Loading repositories…');
  $('refreshBtn').classList.add('spin');
  try {
    const own = await Session.fetchOwnRepos(login, (n) => setStatus(`Loading repositories… ${n}`));
    const collab = await Session.fetchCollabRepos(login).catch(() => []);
    if (login !== state.login) return; // account switched in the meantime
    await mergeRepos([...own, ...collab]);
    await Session.save(login, { collabRepos: collab.map((r) => r.fullName), syncedAt: Date.now() });
    setStatus(`${own.length + collab.length} repositories loaded.`);
    setTimeout(() => setStatus(''), 2500);
    render();
  } catch (err) {
    setStatus(`Couldn't read repositories (${err.message}).`, true);
  } finally {
    fetching = false;
    $('refreshBtn').classList.remove('spin');
  }
}

// ---------- Folder operations ----------

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
    name: parentId ? 'New subfolder' : 'New folder',
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

function deleteFolder(id) {
  // Subfolders and repositories move up to the parent; nothing is deleted on GitHub.
  state.folders = FolderTree.remove(state.folders, id);
  save();
  render();
}

function moveFolder(id, parentId) {
  if (!FolderTree.setParent(state.folders, id, parentId)) return;
  const parent = FolderTree.byId(state.folders, parentId);
  if (parent) parent.collapsed = false;
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
  const nameEl = document.querySelector(`.folder[data-id="${id}"] > .folder-head .folder-name`);
  const folder = state.folders.find((f) => f.id === id);
  if (!nameEl || !folder) return;
  nameEl.closest('.folder-head').draggable = false; // otherwise the input can't select text
  const input = el('input', { className: 'input', type: 'text', value: folder.name });
  input.addEventListener('click', (e) => e.stopPropagation());
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) folder.name = input.value.trim();
    input.remove(); // must go before render, which is skipped while editing
    save();
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// ---------- Rendering ----------

function setStatus(text, isError = false) {
  const s = $('status');
  s.textContent = text;
  s.hidden = !text;
  s.classList.toggle('error', isError);
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const TIME_UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

function timeAgo(iso) {
  const secs = (new Date(iso) - Date.now()) / 1000;
  for (const [unit, size] of TIME_UNITS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return 'just now';
}

function languageColor(repo) {
  return repo?.languageColor || LANGUAGE_COLORS[repo?.language] || '#8b949e';
}

function matches(fullName) {
  if (!state.query) return true;
  const repo = findRepo(fullName);
  return `${fullName} ${repo?.description || ''} ${repo?.language || ''}`.toLowerCase().includes(state.query);
}

function makeDropTarget(node, folderId) {
  node.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation(); // only the innermost folder is highlighted
    document.querySelectorAll('.drop-target').forEach((n) => n !== node && n.classList.remove('drop-target'));
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget)) node.classList.remove('drop-target');
  });
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove('drop-target');
    const fullName = e.dataTransfer.getData('text/x-repo');
    const draggedFolder = e.dataTransfer.getData('text/x-folder');
    if (fullName) moveRepo(fullName, folderId);
    else if (draggedFolder) moveFolder(draggedFolder, folderId === UNSORTED ? null : folderId);
  });
}

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
  const bar = el('div', { className: 'langbar' });
  bar.title = [...counts].map(([lang, c]) => `${lang} ${Math.round((c.count / total) * 100)}%`).join(' · ');
  for (const [, c] of [...counts].sort((a, b) => b[1].count - a[1].count)) {
    const seg = el('i');
    seg.style.flexGrow = c.count;
    seg.style.background = c.color;
    bar.append(seg);
  }
  return bar;
}

function render() {
  if (document.querySelector('.folder-head input')) return; // don't interrupt a rename
  const container = $('folders');
  const signedIn = !!state.login;
  for (const id of ['toolbar', 'refreshBtn', 'settingsBtn', 'footer']) $(id).hidden = !signedIn;
  if (!signedIn) {
    $('settings').hidden = true;
    $('subtitle').textContent = state.login === null ? 'Detecting account…' : 'Signed out';
    container.replaceChildren(state.login === null ? '' : el('div', { className: 'blankslate signed-out' }, icon('lock'),
      el('h3', { textContent: 'Sign in to GitHub' }),
      el('p', { textContent: 'The extension uses the account signed in on github.com. Each account has its own folders.' }),
      el('a', { className: 'btn btn-primary', href: 'https://github.com/login', target: '_blank', rel: 'noopener', textContent: 'Sign in' })));
    return;
  }

  const unsorted = state.repos.map((r) => r.fullName).filter((n) => !folderOf(n));
  // Also lets you organize the repository open in the current tab, even if it isn't yours.
  const cur = state.currentRepo;
  if (cur && !folderOf(cur) && !unsorted.some((n) => n.toLowerCase() === cur.toLowerCase())) unsorted.unshift(cur);

  const nodes = FolderTree.children(state.folders).map((f) => renderFolder(f, 0)).filter(Boolean);
  if (state.folders.length === 0) {
    nodes.unshift(el('div', { className: 'blankslate' }, icon('folderPlus'),
      el('h3', { textContent: 'No folders yet' }),
      el('p', { textContent: 'Create a folder and drag repositories into it.' })));
  }
  nodes.push(renderUnsorted(unsorted));
  container.replaceChildren(...nodes.filter(Boolean));

  const organized = state.folders.reduce((s, f) => s + f.repos.length, 0);
  const nf = state.folders.length;
  $('subtitle').textContent = `${nf} folder${nf === 1 ? '' : 's'} · ${organized} of ${state.repos.length} repositories organized`;
}

function folderHead({ collapsed, onToggle, iconNode, name, count, actions }) {
  const head = el('div', { className: 'folder-head' },
    el('span', { className: 'chevron' }, icon('chevron')),
    iconNode,
    name,
    el('span', { className: 'counter', textContent: count }),
    actions ? el('span', { className: 'folder-actions' }, ...actions) : null);
  head.setAttribute('aria-expanded', String(!collapsed));
  head.addEventListener('click', (e) => {
    if (e.target.closest('button, input, select, a')) return;
    onToggle();
  });
  return head;
}

function renderFolder(folder, depth) {
  const allNames = FolderTree.allRepos(state.folders, folder);
  const searching = !!state.query;
  if (searching && !allNames.some(matches)) return null;
  const collapsed = folder.collapsed && !searching;

  const folderIcon = el('button', { className: 'btn-icon btn-sm folder-icon', type: 'button', title: 'Change color' }, icon('folder'));
  folderIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleColor(folder);
  });
  const name = el('span', { className: 'folder-name', textContent: folder.name, title: 'Double-click to rename' });
  name.addEventListener('dblclick', () => startRename(folder.id));

  const head = folderHead({
    collapsed,
    onToggle: () => {
      folder.collapsed = !folder.collapsed;
      save();
      render();
    },
    iconNode: folderIcon,
    name,
    count: searching ? `${allNames.filter(matches).length}/${allNames.length}` : allNames.length,
    actions: [
      iconButton('folderPlus', 'New subfolder', () => createFolder(folder.id)),
      iconButton('edit', 'Rename', () => startRename(folder.id)),
      iconButton('trash', 'Delete folder (contents move up to the parent folder)', () => deleteFolder(folder.id), 'btn-danger'),
    ],
  });
  head.draggable = true;
  head.title = 'Drag into another folder to make it a subfolder';
  head.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/x-folder', folder.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  const body = el('div', { className: 'folder-body' });
  if (!collapsed) {
    const subfolders = FolderTree.children(state.folders, folder.id).map((f) => renderFolder(f, depth + 1)).filter(Boolean);
    body.append(...subfolders);
    const visible = folder.repos.filter(matches);
    if (visible.length) body.append(el('ul', { className: 'repos' }, ...visible.map((n) => renderRepo(n, folder.id))));
    if (folder.repos.length === 0 && subfolders.length === 0) {
      body.append(el('div', { className: 'empty', textContent: 'Drag repositories or folders here' }));
    }
  }

  const node = el('section', { className: `folder${collapsed ? ' collapsed' : ''}` },
    head, depth === 0 ? languageBar(allNames) : null, body);
  node.dataset.id = folder.id;
  node.style.setProperty('--folder-color', folderColor(folder));
  node.style.setProperty('--depth', depth);
  makeDropTarget(node, folder.id);
  return node;
}

function renderUnsorted(names) {
  const visible = names.filter(matches);
  if (state.query && visible.length === 0) return null;
  const collapsed = state.unsortedCollapsed && !state.query;
  const head = folderHead({
    collapsed,
    onToggle: () => {
      state.unsortedCollapsed = !state.unsortedCollapsed;
      save();
      render();
    },
    iconNode: el('span', { className: 'btn-icon btn-sm folder-icon' }, icon('inbox')),
    name: el('span', { className: 'folder-name', textContent: 'Unsorted' }),
    count: state.query ? `${visible.length}/${names.length}` : names.length,
  });
  const body = el('div', { className: 'folder-body' });
  if (!collapsed) {
    body.append(visible.length
      ? el('ul', { className: 'repos' }, ...visible.map((n) => renderRepo(n, UNSORTED)))
      : el('div', { className: 'empty', textContent: names.length ? 'Nothing found.' : 'Every repository is organized 🎉' }));
  }
  const node = el('section', { className: `folder unsorted${collapsed ? ' collapsed' : ''}` }, head, body);
  makeDropTarget(node, UNSORTED);
  return node;
}

// An invisible native <select> over a button: an alternative to dragging.
function moveSelect(fullName, currentId) {
  const select = el('select', { title: 'Move to folder' });
  select.append(new Option('Move to…', '', true, true));
  select.options[0].disabled = true;
  for (const { folder, depth } of FolderTree.flatten(state.folders)) {
    const opt = new Option(FolderTree.optionLabel(folder, depth), folder.id);
    opt.disabled = folder.id === currentId;
    select.append(opt);
  }
  if (currentId !== UNSORTED) select.append(new Option('— Remove from folder —', UNSORTED));
  select.addEventListener('change', () => moveRepo(fullName, select.value));
  return el('span', { className: 'btn-icon btn-sm move' }, icon('more'), select);
}

function renderRepo(fullName, folderId) {
  const repo = findRepo(fullName) || { fullName };
  const [owner, name] = fullName.split('/');
  const isMine = owner.toLowerCase() === state.login.toLowerCase();

  const link = el('a', { className: 'repo-link', href: `https://github.com/${fullName}`, target: '_blank', rel: 'noopener', title: fullName },
    isMine ? null : el('span', { className: 'owner', textContent: `${owner} / ` }), name);

  const meta = el('div', { className: 'repo-meta' });
  if (repo.language) {
    const dot = el('i', { className: 'lang-dot' });
    dot.style.background = languageColor(repo);
    meta.append(el('span', {}, dot, repo.language));
  }
  if (repo.stars) meta.append(el('span', { title: 'Stars' }, icon('star'), String(repo.stars)));
  if (repo.forks) meta.append(el('span', { title: 'Forks' }, icon('fork'), String(repo.forks)));
  if (repo.updatedAt) meta.append(el('span', { title: new Date(repo.updatedAt).toLocaleString('en-US') }, `Updated ${timeAgo(repo.updatedAt)}`));

  const main = el('div', { className: 'repo-main' },
    el('div', { className: 'repo-title' }, link,
      el('span', { className: 'label', textContent: repo.private ? 'Private' : 'Public' }),
      repo.fork ? el('span', { className: 'label', textContent: 'Fork' }) : null,
      repo.archived ? el('span', { className: 'label warn', textContent: 'Archived' }) : null),
    repo.description ? el('div', { className: 'repo-desc', textContent: repo.description, title: repo.description }) : null,
    meta.childElementCount ? meta : null);

  const node = el('li', { className: 'repo', draggable: true },
    el('span', { className: 'repo-icon' }, icon(repo.private ? 'lock' : 'repo')), main, moveSelect(fullName, folderId));
  if (state.currentRepo?.toLowerCase() === fullName.toLowerCase()) {
    node.classList.add('current');
    node.title = 'Repository open in the current tab';
  }
  node.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/x-repo', fullName);
    e.dataTransfer.effectAllowed = 'move';
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('dragging'));
  return node;
}

// ---------- Repository in the active tab ----------

const NOT_REPO_OWNERS = new Set(['settings', 'orgs', 'organizations', 'notifications', 'marketplace', 'explore',
  'topics', 'collections', 'pulls', 'issues', 'codespaces', 'sponsors', 'search', 'trending', 'login', 'new']);

async function detectCurrentRepo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const match = tab?.url?.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/);
  const next = match && !NOT_REPO_OWNERS.has(match[1].toLowerCase()) ? `${match[1]}/${match[2]}` : null;
  if (next !== state.currentRepo) {
    state.currentRepo = next;
    render();
  }
}

// ---------- Header / settings / export / import ----------

function renderProfile() {
  const login = state.login;
  $('profileLink').hidden = !login;
  if (login) {
    const avatar = `https://github.com/${encodeURIComponent(login)}.png?size=96`;
    $('profileLink').href = `https://github.com/${encodeURIComponent(login)}`;
    $('profileLink').title = login;
    $('avatar').src = avatar;
    $('accountAvatar').src = avatar;
    $('accountLogin').textContent = login;
  }
  $('openRepos').href = login ? `https://github.com/${encodeURIComponent(login)}?tab=repositories` : 'https://github.com/';
}

function toggleSettings(force) {
  const open = force ?? $('settings').hidden;
  $('settings').hidden = !open;
  $('settingsBtn').classList.toggle('active', open);
}

function bindSettings() {
  $('settingsBtn').addEventListener('click', () => toggleSettings());

  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ folders: state.folders }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'github-repo-folders.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.folders)) throw new Error();
      state.folders = data.folders.map((f) => ({
        id: f.id || crypto.randomUUID(),
        name: String(f.name || 'Folder'),
        collapsed: !!f.collapsed,
        repos: Array.isArray(f.repos) ? f.repos.map(String) : [],
        parentId: f.parentId || null,
        ...(f.color ? { color: String(f.color) } : {}),
      }));
      await save();
      render();
      setStatus('Folders imported.');
    } catch {
      setStatus('Invalid file.', true);
    }
    e.target.value = '';
  });
}

// ---------- Startup ----------

async function init() {
  await load();
  bindSettings();

  $('refreshBtn').append(icon('refresh'));
  $('settingsBtn').append(icon('gear'));
  $('searchIcon').replaceWith(icon('search'));
  $('newFolderBtn').append(icon('plus'), 'Folder');

  $('newFolderBtn').addEventListener('click', () => createFolder());
  $('refreshBtn').addEventListener('click', fetchRepos);
  $('searchInput').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  // Stays in sync with the GitHub page, including account switches
  // (the page records the signed-in account every time it loads).
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' && area !== 'sync') return;
    const switched = 'account' in changes;
    if (!switched && !(state.login && Session.changed(state.login, changes, area))) return;
    await load();
    renderProfile();
    render();
    if (switched && state.login && Session.isStale(state.syncedAt)) fetchRepos();
  });

  chrome.tabs.onActivated.addListener(detectCurrentRepo);
  chrome.tabs.onUpdated.addListener((_id, info) => info.url && detectCurrentRepo());

  renderProfile();
  render();
  detectCurrentRepo();
  detectAccount();
  // When returning to the panel (e.g. after switching accounts in another tab), re-check the account.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && detectAccount());
}

init();
