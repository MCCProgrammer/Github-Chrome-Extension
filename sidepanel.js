// Estado guardado em chrome.storage.local:
//   settings: { username, token }
//   folders:  [{ id, name, collapsed, repos: ["owner/name", ...] }]
//   repos:    cache dos repositórios vindos da API
//   unsortedCollapsed: boolean
const UNSORTED = '__unsorted__';

const state = {
  settings: { username: '', token: '' },
  folders: [],
  repos: [],
  unsortedCollapsed: false,
  query: '',
  currentRepo: null,
};

const $ = (id) => document.getElementById(id);

// ---------- Armazenamento ----------

async function load() {
  const data = await chrome.storage.local.get(['settings', 'folders', 'repos', 'unsortedCollapsed']);
  Object.assign(state, {
    settings: data.settings || state.settings,
    folders: data.folders || [],
    repos: data.repos || [],
    unsortedCollapsed: !!data.unsortedCollapsed,
  });
}

function save() {
  return chrome.storage.local.set({
    folders: state.folders,
    unsortedCollapsed: state.unsortedCollapsed,
  });
}

// ---------- API do GitHub ----------

async function fetchRepos() {
  const { username, token } = state.settings;
  if (!username && !token) {
    setStatus('Define o teu utilizador GitHub nas definições (⚙).');
    $('settings').classList.remove('hidden');
    return;
  }

  setStatus('A carregar repositórios…');
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const base = token
    ? 'https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated'
    : `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner&sort=updated`;

  const all = [];
  try {
    for (let page = 1; ; page++) {
      const res = await fetch(`${base}&per_page=100&page=${page}`, { headers });
      if (!res.ok) {
        const msg = res.status === 401 ? 'Token inválido.'
          : res.status === 404 ? 'Utilizador não encontrado.'
          : res.status === 403 ? 'Limite da API atingido — adiciona um token.'
          : `Erro ${res.status}.`;
        throw new Error(msg);
      }
      const batch = await res.json();
      all.push(...batch);
      if (batch.length < 100) break;
    }
  } catch (err) {
    setStatus(err.message, true);
    return;
  }

  state.repos = all.map((r) => ({
    fullName: r.full_name,
    description: r.description || '',
    private: r.private,
    fork: r.fork,
    archived: r.archived,
  }));
  await chrome.storage.local.set({ repos: state.repos });
  setStatus(`${state.repos.length} repositórios carregados.`);
  setTimeout(() => setStatus(''), 2500);
  render();
}

// ---------- Operações sobre pastas ----------

function folderOf(fullName) {
  return state.folders.find((f) => f.repos.includes(fullName));
}

function moveRepo(fullName, folderId) {
  for (const f of state.folders) f.repos = f.repos.filter((r) => r !== fullName);
  if (folderId !== UNSORTED) {
    const target = state.folders.find((f) => f.id === folderId);
    if (target) target.repos.push(fullName);
  }
  save();
  render();
}

function createFolder(parentId = null) {
  const folder = { id: crypto.randomUUID(), name: parentId ? 'Nova subpasta' : 'Nova pasta', collapsed: false, repos: [], parentId };
  state.folders.push(folder);
  const parent = FolderTree.byId(state.folders, parentId);
  if (parent) parent.collapsed = false;
  save();
  render();
  startRename(folder.id);
}

function deleteFolder(id) {
  // Subpastas e repositórios sobem para a pasta-mãe; nada é apagado no GitHub.
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

function startRename(id) {
  const nameEl = document.querySelector(`.folder[data-id="${id}"] > .folder-head .folder-name`);
  const folder = state.folders.find((f) => f.id === id);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = folder.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit && input.value.trim()) folder.name = input.value.trim();
    save();
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// ---------- Renderização ----------

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function matches(fullName) {
  if (!state.query) return true;
  const repo = state.repos.find((r) => r.fullName === fullName);
  const haystack = `${fullName} ${repo?.description || ''}`.toLowerCase();
  return haystack.includes(state.query);
}

function render() {
  const container = $('folders');
  container.replaceChildren();

  const assigned = new Set(state.folders.flatMap((f) => f.repos));
  const unsorted = state.repos.map((r) => r.fullName).filter((n) => !assigned.has(n));
  // Permite organizar também o repositório aberto no separador, mesmo que não seja teu.
  const cur = state.currentRepo;
  if (cur && !assigned.has(cur) && !unsorted.some((n) => n.toLowerCase() === cur.toLowerCase())) {
    unsorted.unshift(cur);
  }

  for (const folder of FolderTree.children(state.folders)) {
    container.append(renderFolder(folder.id, folder.name, folder.repos, folder.collapsed));
  }
  container.append(renderFolder(UNSORTED, 'Sem pasta', unsorted, state.unsortedCollapsed));
}

function renderFolder(id, name, repoNames, collapsed) {
  const node = $('folderTpl').content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  if (id === UNSORTED) node.classList.add('unsorted');

  const folder = FolderTree.byId(state.folders, id);
  const subfolders = folder ? FolderTree.children(state.folders, id) : [];
  const allNames = folder ? FolderTree.allRepos(state.folders, folder) : repoNames;
  const visible = repoNames.filter(matches);
  const searching = !!state.query;
  if (searching && !allNames.some(matches)) node.hidden = true;
  if (collapsed && !searching) node.classList.add('collapsed');

  node.querySelector('.folder-name').textContent = name;
  const total = allNames.length;
  node.querySelector('.count').textContent = searching ? `${allNames.filter(matches).length}/${total}` : total;

  const head = node.querySelector('.folder-head');
  if (folder) {
    head.draggable = true;
    head.title = 'Arrasta para dentro de outra pasta para a tornar subpasta';
    head.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('text/x-folder', id);
      e.dataTransfer.effectAllowed = 'move';
    });
  }
  node.querySelector('.children').append(
    ...subfolders.map((f) => renderFolder(f.id, f.name, f.repos, f.collapsed)),
  );

  node.querySelector('.toggle').addEventListener('click', () => {
    if (id === UNSORTED) state.unsortedCollapsed = !state.unsortedCollapsed;
    else {
      const f = state.folders.find((x) => x.id === id);
      f.collapsed = !f.collapsed;
    }
    save();
    render();
  });
  node.querySelector('.folder-name').addEventListener('dblclick', () => id !== UNSORTED && startRename(id));
  node.querySelector('.rename').addEventListener('click', () => startRename(id));
  node.querySelector('.delete').addEventListener('click', () => deleteFolder(id));
  node.querySelector('.add-sub').addEventListener('click', () => createFolder(id));

  // Drag & drop: repositórios vão para a pasta; pastas passam a subpasta
  // (largar uma pasta em "Sem pasta" volta a pô-la no topo).
  node.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
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
    if (fullName) moveRepo(fullName, id);
    else if (draggedFolder) moveFolder(draggedFolder, id === UNSORTED ? null : id);
  });

  const list = node.querySelector('.repos');
  for (const fullName of visible) list.append(renderRepo(fullName, id));
  if (repoNames.length === 0 && subfolders.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = id === UNSORTED ? 'Todos os repositórios estão organizados 🎉' : 'Arrasta repositórios ou pastas para aqui';
    list.append(empty);
  }
  return node;
}

function renderRepo(fullName, folderId) {
  const node = $('repoTpl').content.firstElementChild.cloneNode(true);
  const repo = state.repos.find((r) => r.fullName === fullName);
  const [owner, name] = fullName.split('/');

  if (state.currentRepo && state.currentRepo.toLowerCase() === fullName.toLowerCase()) {
    node.classList.add('current');
  }

  const link = node.querySelector('.repo-link');
  link.href = `https://github.com/${fullName}`;
  link.title = repo?.description || fullName;
  const ownerSpan = document.createElement('span');
  ownerSpan.className = 'owner';
  ownerSpan.textContent = `${owner}/`;
  link.append(ownerSpan, name);

  const badges = node.querySelector('.badges');
  if (repo?.private) badges.append(badge('privado'));
  if (repo?.fork) badges.append(badge('fork'));
  if (repo?.archived) badges.append(badge('arquivado'));

  // Alternativa ao drag & drop: menu para mover.
  const select = node.querySelector('.move');
  select.append(new Option('📁', '', true, true));
  select.options[0].disabled = true;
  for (const { folder, depth } of FolderTree.flatten(state.folders)) {
    const opt = new Option(FolderTree.optionLabel(folder, depth), folder.id);
    opt.disabled = folder.id === folderId;
    select.append(opt);
  }
  if (folderId !== UNSORTED) select.append(new Option('→ Sem pasta', UNSORTED));
  select.addEventListener('change', () => moveRepo(fullName, select.value));

  node.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/x-repo', fullName);
    e.dataTransfer.effectAllowed = 'move';
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('dragging'));
  return node;
}

function badge(text) {
  const el = document.createElement('span');
  el.className = 'badge';
  el.textContent = text;
  return el;
}

// ---------- Repositório do separador ativo ----------

async function detectCurrentRepo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const match = tab?.url?.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/);
  const next = match ? `${match[1]}/${match[2]}` : null;
  if (next !== state.currentRepo) {
    state.currentRepo = next;
    render();
  }
}

// ---------- Definições / exportar / importar ----------

function bindSettings() {
  $('settingsBtn').addEventListener('click', () => $('settings').classList.toggle('hidden'));
  $('usernameInput').value = state.settings.username;
  $('tokenInput').value = state.settings.token;

  $('saveSettingsBtn').addEventListener('click', async () => {
    state.settings = {
      username: $('usernameInput').value.trim(),
      token: $('tokenInput').value.trim(),
    };
    await chrome.storage.local.set({ settings: state.settings });
    $('settings').classList.add('hidden');
    fetchRepos();
  });

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
        name: String(f.name || 'Pasta'),
        collapsed: !!f.collapsed,
        repos: Array.isArray(f.repos) ? f.repos.map(String) : [],
        parentId: f.parentId || null,
      }));
      await save();
      render();
      setStatus('Pastas importadas.');
    } catch {
      setStatus('Ficheiro inválido.', true);
    }
    e.target.value = '';
  });
}

// ---------- Arranque ----------

async function init() {
  await load();
  bindSettings();

  $('newFolderBtn').addEventListener('click', () => createFolder());
  $('refreshBtn').addEventListener('click', fetchRepos);
  $('searchInput').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  // Mantém-se sincronizado com as alterações feitas na página do GitHub.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !('folders' in changes || 'repos' in changes)) return;
    if (document.querySelector('.folder input')) return; // não interromper a edição de um nome
    await load();
    render();
  });

  chrome.tabs.onActivated.addListener(detectCurrentRepo);
  chrome.tabs.onUpdated.addListener((_id, info) => info.url && detectCurrentRepo());

  render();
  detectCurrentRepo();
  if (state.repos.length === 0) fetchRepos();
}

init();
