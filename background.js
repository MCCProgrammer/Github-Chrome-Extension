// Abre o painel lateral ao clicar no ícone da extensão.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Repositórios onde o utilizador é colaborador / membro de organização, via API.
// Só funciona com token (definido no painel lateral); sem token responde { repos: null }.
async function fetchCollabRepos() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings?.token) return null;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${settings.token}` };
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
  return all.map((r) => ({
    fullName: r.full_name,
    description: r.description || '',
    private: r.private,
    fork: r.fork,
    archived: r.archived,
  }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'fetchCollabRepos') return;
  fetchCollabRepos().then(
    (repos) => sendResponse({ repos }),
    (err) => sendResponse({ error: err.message }),
  );
  return true; // resposta assíncrona
});
