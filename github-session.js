// Shared by the GitHub page (content.js) and the side panel.
// The account is whichever is signed in on github.com (no token or username to configure)
// and each account has its own data: keys carry the login, e.g. "folders@octocat".
// Repositories are read from GitHub's pages with the session, so private ones are included.
// Folders also go to chrome.storage.sync: they follow the Chrome Google account and show up
// already organized on other computers. The rest (repository cache) is large and stays local.
const GITHUB = 'https://github.com';

const Session = {
  ACCOUNT_KEYS: ['folders', 'repos', 'collabRepos', 'collabCollapsed', 'unsortedCollapsed'],

  key(login, name) {
    return `${name}@${login.toLowerCase()}`;
  },

  // { folders, repos, … } for the account, plus the global keys requested in extraKeys.
  async load(login, extraKeys = []) {
    const keys = this.ACCOUNT_KEYS.map((n) => this.key(login, n));
    const d = await chrome.storage.local.get([...keys, ...extraKeys]);
    const out = Object.fromEntries(extraKeys.map((k) => [k, d[k]]));
    this.ACCOUNT_KEYS.forEach((n, i) => { out[n] = d[keys[i]]; });
    const synced = await this.loadSyncedFolders(login);
    if (synced) out.folders = synced;
    else if (out.folders?.length) this.saveSyncedFolders(login, out.folders); // first time: upload the local folders
    return out;
  },

  // Saves locally (fast, no limits) and, for folders, to sync as well.
  save(login, patch) {
    const local = chrome.storage.local.set(Object.fromEntries(Object.entries(patch).map(([n, v]) => [this.key(login, n), v])));
    return Promise.all([local, patch.folders && this.saveSyncedFolders(login, patch.folders)]);
  },

  // Do the changes affect this account? For 'sync', ignore echoes of writes made here:
  // one could arrive after a newer change and bring back old folders.
  changed(login, changes, area = 'local') {
    if (area === 'sync') {
      const head = changes[this.key(login, 'folders')]?.newValue;
      return !!head && !this.ownWrites.has(head.savedAt);
    }
    return this.ACCOUNT_KEYS.some((n) => this.key(login, n) in changes);
  },

  // ---------- Folders in chrome.storage.sync ----------
  // Sync allows at most 8 KB per item, so the JSON is split into chunks:
  //   "folders@login" = { chunks, savedAt } and "folders@login#0", "#1", … = text.
  // 3000 characters fit in one item even with accents and escaped quotes.
  CHUNK: 3000,
  ownWrites: new Set(), // savedAt of writes made in this context

  async loadSyncedFolders(login) {
    const key = this.key(login, 'folders');
    try {
      const head = (await chrome.storage.sync.get(key))[key];
      if (!head) return null;
      const keys = Array.from({ length: head.chunks }, (_, i) => `${key}#${i}`);
      const parts = await chrome.storage.sync.get(keys);
      return JSON.parse(keys.map((k) => parts[k]).join(''));
    } catch {
      return null; // sync unavailable or mid-update: use the local copy
    }
  },

  async saveSyncedFolders(login, folders) {
    const key = this.key(login, 'folders');
    const json = JSON.stringify(folders);
    const chunks = Math.max(1, Math.ceil(json.length / this.CHUNK));
    const savedAt = Date.now() + Math.random(); // unique, to recognize the echo
    this.ownWrites.add(savedAt);
    const items = { [key]: { chunks, savedAt } };
    for (let i = 0; i < chunks; i++) items[`${key}#${i}`] = json.slice(i * this.CHUNK, (i + 1) * this.CHUNK);
    try {
      const old = (await chrome.storage.sync.get(key))[key];
      await chrome.storage.sync.set(items);
      if (old?.chunks > chunks) {
        await chrome.storage.sync.remove(Array.from({ length: old.chunks - chunks }, (_, i) => `${key}#${chunks + i}`));
      }
    } catch (err) {
      console.warn('GitHub Repo Folders: could not sync folders', err); // they stay local
    }
  },

  // Records the active account. The first time, legacy (pre-account) data moves to it.
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
    if ('settings' in legacy) await chrome.storage.local.remove('settings'); // username/token from older versions
    if (legacy.account !== login) await chrome.storage.local.set({ account: login });
  },

  // ---------- Reading GitHub's pages ----------

  async fetchDoc(path) {
    const res = await fetch(new URL(path, GITHUB), { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  },

  // Signed-in login in that document ('' = signed out, null = not a regular GitHub page).
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

  // Items of the github.com/<user>?tab=repositories list: [{ li, repo }]
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

  // Walks every page of the account's repository list.
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

  // Repositories of other people/organizations the account collaborates on (github.com/settings/repositories).
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
