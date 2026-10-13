// Injeta o painel de pastas na página github.com/<user>?tab=repositories.
// Os repositórios são lidos da própria página (scraping) e partilham o mesmo
// armazenamento que o painel lateral (folders / repos em chrome.storage.local).
const UNSORTED = '__unsorted__';
const MAX_PAGES = 50;

const state = { folders: [], repos: [] };
let syncing = false;

// ---------- Armazenamento ----------

async function load() {
  const d = await chrome.storage.local.get(['folders', 'repos']);
  state.folders = d.folders || [];
  state.repos = d.repos || [];
}

function save() {
  return chrome.storage.local.set({ folders: state.folders });
}

function mergeRepos(found) {
  const byName = new Map(state.repos.map((r) => [r.fullName.toLowerCase(), r]));
  for (const r of found) byName.set(r.fullName.toLowerCase(), r);
  state.repos = [...byName.values()];
  return chrome.storage.local.set({ repos: state.repos });
}

// ---------- Scraping ----------

function scrapeItems(root) {
  return [...root.querySelectorAll('#user-repositories-list li[itemprop~="owns"]')].map((li) => {
    const a = li.querySelector('a[itemprop~="codeRepository"]');
    const labels = [...li.querySelectorAll('h3 .Label')].map((l) => l.textContent.trim().toLowerCase());
    return {
      li,
      repo: {
        fullName: a.getAttribute('href').replace(/^\//, ''),
        description: li.querySelector('[itemprop~="description"]')?.textContent.trim() || '',
        private: labels.some((l) => l.includes('private')),
        archived: labels.some((l) => l.includes('archive')),
        fork: /forked from/i.test(li.textContent),
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

// ---------- Pastas ----------

function folderOf(fullName) {
  const n = fullName.toLowerCase();
  return state.folders.find((f) => f.repos.some((r) => r.toLowerCase() === n));
}

function moveRepo(fullName, folderId) {
  const n = fullName.toLowerCase();
  for (const f of state.folders) f.repos = f.repos.filter((r) => r.toLowerCase() !== n);
  state.folders.find((f) => f.id === folderId)?.repos.push(fullName);
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

function startRename(id) {
  const folder = state.folders.find((f) => f.id === id);
  const nameEl = document.querySelector(`#grf-panel .grf-folder[data-id="${id}"] > .grf-folder-head .grf-folder-name`);
  if (!folder || !nameEl) return;
  const input = el('input', { className: 'form-control input-sm grf-rename', value: folder.name });
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

// ---------- UI ----------

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function setStatus(text, isError = false) {
  const s = document.querySelector('#grf-panel .grf-status');
  if (!s) return;
  s.textContent = text;
  s.classList.toggle('color-fg-danger', isError);
}

function moveSelect(fullName, currentId) {
  const select = el('select', { className: 'form-select select-sm grf-move', title: 'Mover para pasta' });
  select.append(new Option(currentId === UNSORTED ? '📁 Pasta…' : '📁 Mover…', '', true, true));
  select.options[0].disabled = true;
  for (const { folder, depth } of FolderTree.flatten(state.folders)) {
    const opt = new Option(FolderTree.optionLabel(folder, depth), folder.id);
    opt.disabled = folder.id === currentId;
    select.append(opt);
  }
  if (currentId !== UNSORTED) select.append(new Option('— Sem pasta —', UNSORTED));
  select.addEventListener('change', () => moveRepo(fullName, select.value));
  return select;
}

function makeDraggable(node, value, type = 'text/x-repo') {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.dataTransfer.setData(type, value);
    e.dataTransfer.effectAllowed = 'move';
    node.classList.add('grf-dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('grf-dragging'));
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
    const fullName = e.dataTransfer.getData('text/x-repo');
    const draggedFolder = e.dataTransfer.getData('text/x-folder');
    if (fullName) moveRepo(fullName, folderId);
    else if (draggedFolder) moveFolder(draggedFolder, folderId === UNSORTED ? null : folderId);
  });
}

function renderFolder(folder) {
  const owner = profileOwner().toLowerCase();
  const toggle = el('button', { className: 'btn-octicon grf-toggle', type: 'button', title: 'Expandir/recolher', textContent: folder.collapsed ? '▸' : '▾' });
  const name = el('span', { className: 'grf-folder-name', textContent: folder.name });
  const total = FolderTree.allRepos(state.folders, folder).length;
  const count = el('span', { className: 'Counter', textContent: total, title: `${total} repositórios (incluindo subpastas)` });
  const addSub = el('button', { className: 'btn-octicon', type: 'button', title: 'Nova subpasta', textContent: '+📁' });
  const rename = el('button', { className: 'btn-octicon', type: 'button', title: 'Mudar nome', textContent: '✎' });
  const del = el('button', { className: 'btn-octicon', type: 'button', title: 'Apagar pasta (o conteúdo sobe para a pasta-mãe)', textContent: '🗑' });

  const head = el('div', { className: 'grf-folder-head', title: 'Arrasta para dentro de outra pasta para a tornar subpasta' },
    toggle, '📁', name, count, el('span', { className: 'grf-actions' }, addSub, rename, del));
  makeDraggable(head, folder.id, 'text/x-folder');

  const subfolders = FolderTree.children(state.folders, folder.id);
  const childBox = el('div', { className: 'grf-children' }, ...subfolders.map(renderFolder));
  const list = el('ul', { className: 'grf-repos' });

  for (const fullName of folder.repos) {
    const repo = state.repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
    const [o, n] = fullName.split('/');
    const link = el('a', { href: `/${fullName}`, className: 'Link--primary', title: repo?.description || fullName });
    if (o.toLowerCase() !== owner) link.append(el('span', { className: 'color-fg-muted', textContent: `${o}/` }));
    link.append(n);
    const row = el('li', { className: 'grf-repo' }, link);
    if (repo?.private) row.append(el('span', { className: 'Label Label--secondary', textContent: 'Private' }));
    if (repo?.archived) row.append(el('span', { className: 'Label Label--attention', textContent: 'Archived' }));
    if (repo?.fork) row.append(el('span', { className: 'Label Label--secondary', textContent: 'Fork' }));
    row.append(moveSelect(fullName, folder.id));
    makeDraggable(row, fullName);
    list.append(row);
  }
  if (folder.repos.length === 0 && subfolders.length === 0) {
    list.append(el('li', { className: 'grf-empty color-fg-muted', textContent: 'Arrasta repositórios ou pastas para aqui' }));
  }

  const node = el('div', { className: `grf-folder${folder.collapsed ? ' grf-collapsed' : ''}` }, head, childBox, list);
  node.dataset.id = folder.id;

  toggle.addEventListener('click', () => {
    folder.collapsed = !folder.collapsed;
    save();
    render();
  });
  name.addEventListener('dblclick', () => startRename(folder.id));
  rename.addEventListener('click', () => startRename(folder.id));
  addSub.addEventListener('click', () => createFolder(folder.id));
  del.addEventListener('click', () => deleteFolder(folder.id));
  makeDropTarget(node, folder.id);
  return node;
}

function renderPanel() {
  let panel = document.getElementById('grf-panel');
  const list = document.getElementById('user-repositories-list');
  if (!list) return;
  if (!panel) {
    const syncBtn = el('button', { className: 'btn btn-sm', type: 'button', textContent: '⟳ Sincronizar páginas', title: 'Lê todas as páginas da lista de repositórios' });
    syncBtn.addEventListener('click', syncAllPages);
    const newBtn = el('button', { className: 'btn btn-sm btn-primary', type: 'button', textContent: '+ Nova pasta' });
    newBtn.addEventListener('click', () => createFolder());

    panel = el('div', { id: 'grf-panel', className: 'Box mt-3 mb-3' },
      el('div', { className: 'Box-header d-flex flex-items-center flex-wrap grf-header' },
        el('h3', { className: 'Box-title flex-auto', textContent: '📁 Pastas' }),
        syncBtn, newBtn),
      el('div', { className: 'grf-status f6 color-fg-muted' }),
      el('div', { className: 'grf-folders' }));
    makeDropTarget(panel.querySelector('.grf-folders'), UNSORTED);
    list.before(panel);
  }

  const container = panel.querySelector('.grf-folders');
  container.replaceChildren(...FolderTree.children(state.folders).map(renderFolder));
  if (state.folders.length === 0) {
    container.append(el('div', { className: 'grf-empty color-fg-muted', textContent: 'Ainda não tens pastas. Cria uma e arrasta repositórios da lista abaixo para dentro dela.' }));
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
    const bar = el('span', { className: 'grf-item-bar' }, moveSelect(repo.fullName, UNSORTED));
    li.querySelector('h3')?.append(bar);
  }
}

function render() {
  if (!document.getElementById('user-repositories-list')) return;
  renderPanel();
  decorateList();
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
  const owner = profileOwner().toLowerCase();
  const hasMorePages = document.querySelector('.paginate-container a[rel="next"], a.next_page');
  const knownForOwner = state.repos.filter((r) => r.fullName.toLowerCase().startsWith(`${owner}/`)).length;
  if (hasMorePages && knownForOwner <= onPage.length) syncAllPages();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !('folders' in changes || 'repos' in changes)) return;
  if (document.querySelector('#grf-panel .grf-rename')) return; // não interromper a edição de um nome
  await load();
  render();
});

new MutationObserver(() => mountIfNeeded()).observe(document.documentElement, { childList: true, subtree: true });
mountIfNeeded();
