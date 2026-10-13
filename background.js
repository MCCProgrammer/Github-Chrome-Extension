// Abre o painel lateral ao clicar no ícone da extensão.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

async function apiHeaders() {
  const { settings } = await chrome.storage.local.get('settings');
  const headers = { Accept: 'application/vnd.github+json' };
  if (settings?.token) headers.Authorization = `Bearer ${settings.token}`;
  return { headers, hasToken: !!settings?.token };
}

function toRepo(r) {
  return {
    fullName: r.full_name,
    description: r.description || '',
    private: r.private,
    fork: r.fork,
    archived: r.archived,
    language: r.language || '',
    updatedAt: r.pushed_at || r.updated_at,
    createdAt: r.created_at,
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count, // inclui PRs abertos
    license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : (r.license?.name || ''),
    topics: r.topics || [],
    size: r.size, // KB
    homepage: r.homepage || '',
  };
}

// Repositórios onde o utilizador é colaborador / membro de organização, via API.
// Só funciona com token (definido no painel lateral); sem token devolve null.
async function fetchCollabRepos() {
  const { headers, hasToken } = await apiHeaders();
  if (!hasToken) return null;
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `https://api.github.com/user/repos?affiliation=collaborator,organization_member&sort=updated&per_page=100&page=${page}`,
      { headers },
    );
    if (!res.ok) throw new Error(res.status === 401 ? 'token inválido' : `erro ${res.status}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.map(toRepo);
}

// Linguagem / última atualização de um repositório que não está na lista do perfil.
// Sem token só funciona para repos públicos (limite de 60 pedidos/hora).
async function fetchRepoInfo(fullName) {
  const { headers } = await apiHeaders();
  const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers });
  if (!res.ok) throw new Error(`erro ${res.status}`);
  return toRepo(await res.json());
}

// ---------- README do perfil (repositório <user>/<user>) ----------

// A API devolve/aceita base64; o README pode ter acentos e emoji, por isso passa por UTF-8.
function decodeBase64(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function permissionError(owner) {
  return `o token não tem permissão de escrita em ${owner}/${owner} (precisa de "Contents: Read and write")`;
}

async function readmeGet(owner) {
  const { headers, hasToken } = await apiHeaders();
  if (!hasToken) throw new Error('é preciso um token — adiciona-o no painel lateral da extensão (⚙)');
  const res = await fetch(`https://api.github.com/repos/${owner}/${owner}/contents/README.md`, { headers });
  if (res.status === 404) {
    const repo = await fetch(`https://api.github.com/repos/${owner}/${owner}`, { headers });
    if (repo.status === 404) {
      throw new Error(`não existe o repositório ${owner}/${owner}. Cria-o (público) no GitHub para teres um README no perfil`);
    }
    return { text: '', sha: null }; // o repositório existe mas ainda não tem README: vai ser criado
  }
  if (res.status === 401) throw new Error('token inválido');
  if (!res.ok) throw new Error(`erro ${res.status} ao ler o README`);
  const data = await res.json();
  return { text: decodeBase64(data.content), sha: data.sha };
}

async function readmePut(owner, text, sha) {
  const { headers } = await apiHeaders();
  const res = await fetch(`https://api.github.com/repos/${owner}/${owner}/contents/README.md`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'docs(readme): atualizar projetos (GitHub Repo Folders)',
      content: encodeBase64(text),
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.status === 403 || res.status === 404) throw new Error(permissionError(owner));
  if (res.status === 409 || res.status === 422) throw new Error('o README mudou entretanto — abre a pré-visualização outra vez');
  if (!res.ok) throw new Error(`erro ${res.status} ao gravar o README`);
  const data = await res.json();
  return { commitUrl: data.commit?.html_url };
}

// Renderiza Markdown com o motor do próprio GitHub, para a pré-visualização ser fiel.
async function renderMarkdown(owner, text) {
  const { headers } = await apiHeaders();
  const res = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode: 'gfm', context: `${owner}/${owner}` }),
  });
  if (!res.ok) throw new Error(`erro ${res.status}`);
  return res.text();
}

// Responde a mensagens assíncronas no formato { ...resultado } ou { error }.
const HANDLERS = {
  readmeGet: (msg) => readmeGet(msg.owner),
  readmePut: (msg) => readmePut(msg.owner, msg.text, msg.sha),
  renderMarkdown: (msg) => renderMarkdown(msg.owner, msg.text).then((html) => ({ html })),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (handler) {
    handler(msg).then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'fetchCollabRepos') {
    fetchCollabRepos().then(
      (repos) => sendResponse({ repos }),
      (err) => sendResponse({ error: err.message }),
    );
    return true; // resposta assíncrona
  }
  if (msg?.type === 'fetchRepoInfo') {
    fetchRepoInfo(msg.fullName).then(
      (repo) => sendResponse({ repo }),
      (err) => sendResponse({ error: err.message }),
    );
    return true;
  }
});
