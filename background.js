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
    stars: r.stargazers_count,
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
