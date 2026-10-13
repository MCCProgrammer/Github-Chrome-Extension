// Abre o painel lateral ao clicar no ícone da extensão.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// API pública do GitHub, sem autenticação (60 pedidos/hora). Os dados da conta
// (incluindo repositórios privados) são lidos das páginas do github.com com a sessão.
const API_HEADERS = { Accept: 'application/vnd.github+json' };

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

// Dados que a lista do perfil não mostra (data de criação, issues, tamanho…). Só repos públicos.
async function fetchRepoInfo(fullName) {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`erro ${res.status}`);
  return toRepo(await res.json());
}

// Renderiza Markdown com o motor do próprio GitHub, para a pré-visualização ser fiel.
async function renderMarkdown(owner, text) {
  const res = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: { ...API_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode: 'gfm', context: `${owner}/${owner}` }),
  });
  if (!res.ok) throw new Error(`erro ${res.status}`);
  return res.text();
}

// Responde a mensagens assíncronas no formato { ...resultado } ou { error }.
const HANDLERS = {
  fetchRepoInfo: (msg) => fetchRepoInfo(msg.fullName).then((repo) => ({ repo })),
  renderMarkdown: (msg) => renderMarkdown(msg.owner, msg.text).then((html) => ({ html })),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (handler) {
    handler(msg).then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  }
});
