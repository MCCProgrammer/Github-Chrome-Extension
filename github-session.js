// Partilhado pela página do GitHub (content.js) e pelo painel lateral.
// A conta é a que tem sessão iniciada no github.com (não há token nem utilizador para configurar)
// e cada conta tem os seus dados: as chaves levam o login, ex.: "folders@octocat".
// Os repositórios são lidos das páginas do GitHub com a sessão, por isso incluem os privados.
const GITHUB = 'https://github.com';

const Session = {
  ACCOUNT_KEYS: ['folders', 'repos', 'collabRepos', 'collabCollapsed', 'unsortedCollapsed'],

  key(login, name) {
    return `${name}@${login.toLowerCase()}`;
  },

  // { folders, repos, … } da conta, mais as chaves globais pedidas em extraKeys.
  async load(login, extraKeys = []) {
    const keys = this.ACCOUNT_KEYS.map((n) => this.key(login, n));
    const d = await chrome.storage.local.get([...keys, ...extraKeys]);
    const out = Object.fromEntries(extraKeys.map((k) => [k, d[k]]));
    this.ACCOUNT_KEYS.forEach((n, i) => { out[n] = d[keys[i]]; });
    return out;
  },

  save(login, patch) {
    return chrome.storage.local.set(Object.fromEntries(Object.entries(patch).map(([n, v]) => [this.key(login, n), v])));
  },

  changed(login, changes) {
    return this.ACCOUNT_KEYS.some((n) => this.key(login, n) in changes);
  },

  // Regista a conta ativa. Na primeira vez, os dados antigos (anteriores às contas) passam para ela.
  async setAccount(login) {
    const legacy = await chrome.storage.local.get(['account', 'settings', ...this.ACCOUNT_KEYS]);
    if (login && this.ACCOUNT_KEYS.some((n) => n in legacy)) {
      const own = await chrome.storage.local.get(this.ACCOUNT_KEYS.map((n) => this.key(login, n)));
      const patch = {};
      for (const n of this.ACCOUNT_KEYS) {
        if (n in legacy && !(this.key(login, n) in own)) patch[this.key(login, n)] = legacy[n];
      }
      await chrome.storage.local.set(patch);
      await chrome.storage.local.remove(this.ACCOUNT_KEYS);
    }
    if ('settings' in legacy) await chrome.storage.local.remove('settings'); // utilizador/token de versões antigas
    if (legacy.account !== login) await chrome.storage.local.set({ account: login });
  },

  // ---------- Leitura das páginas do GitHub ----------

  async fetchDoc(path) {
    const res = await fetch(new URL(path, GITHUB), { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  },

  // Login com sessão iniciada nesse documento ('' = sem sessão, null = não é uma página normal do GitHub).
  loginIn(doc) {
    const meta = doc.querySelector('meta[name="user-login"]');
    return meta ? meta.content : null;
  },

  async detectLogin() {
    return this.loginIn(await this.fetchDoc('/settings/profile')) || '';
  },

  parseCount(text) {
    const t = (text || '').trim().toLowerCase().replace(/,/g, '');
    const n = parseFloat(t);
    if (Number.isNaN(n)) return undefined;
    return Math.round(t.endsWith('k') ? n * 1000 : n);
  },

  // Itens da lista github.com/<user>?tab=repositories: [{ li, repo }]
  parseRepoList(root) {
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
          stars: this.parseCount(li.querySelector(`a[href="/${fullName}/stargazers"]`)?.textContent) ?? 0,
          forks: this.parseCount(li.querySelector(`a[href="/${fullName}/forks"]`)?.textContent) ?? 0,
          license: li.querySelector('.octicon-law')?.parentElement.textContent.trim() || '',
          topics: [...li.querySelectorAll('a.topic-tag')].map((t) => t.textContent.trim()),
        },
      };
    });
  },

  nextPage(doc) {
    return doc.querySelector('.paginate-container a[rel="next"], a.next_page')?.getAttribute('href');
  },

  // Percorre todas as páginas da lista de repositórios da conta.
  async fetchOwnRepos(login, onProgress = () => {}) {
    const found = [];
    let path = `/${login}?tab=repositories`;
    for (let i = 0; path && i < 50; i++) {
      const doc = await this.fetchDoc(path);
      found.push(...this.parseRepoList(doc).map((x) => x.repo));
      onProgress(found.length);
      path = this.nextPage(doc);
    }
    return found;
  },

  RESERVED_OWNERS: new Set(['settings', 'orgs', 'organizations', 'users', 'notifications', 'marketplace',
    'features', 'enterprise', 'sponsors', 'topics', 'collections', 'explore', 'pulls', 'issues', 'codespaces',
    'login', 'logout', 'new', 'apps', 'account', 'dashboard', 'copilot', 'github-copilot', 'site', 'about',
    'pricing', 'security', 'customer-stories', 'readme', 'team', 'trending', 'search', 'contact', 'blog', 'watching', 'stars']),

  // Repositórios de outras pessoas/organizações onde a conta colabora (github.com/settings/repositories).
  async fetchCollabRepos(login) {
    const doc = await this.fetchDoc('/settings/repositories');
    const root = doc.querySelector('main') || doc.body;
    const names = new Map();
    for (const a of root.querySelectorAll('a[href]')) {
      const m = a.getAttribute('href').match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
      if (!m || this.RESERVED_OWNERS.has(m[1].toLowerCase()) || m[1].toLowerCase() === login.toLowerCase()) continue;
      const fullName = `${m[1]}/${m[2]}`;
      names.set(fullName.toLowerCase(), { fullName });
    }
    return [...names.values()];
  },
};
