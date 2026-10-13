// Gera a secção "os meus projetos" do README do perfil (github.com/<user>/<user>)
// a partir das pastas. Só o bloco entre os marcadores é da extensão; o resto do
// README nunca é tocado.
const ProfileReadme = {
  START: '<!-- REPO-FOLDERS:START -->',
  END: '<!-- REPO-FOLDERS:END -->',

  // Logótipos do simple-icons (shields.io) para as linguagens mais comuns.
  LOGOS: {
    JavaScript: 'javascript', TypeScript: 'typescript', Python: 'python', HTML: 'html5', CSS: 'css',
    'C++': 'cplusplus', C: 'c', Java: 'openjdk', Go: 'go', Rust: 'rust', PHP: 'php', Ruby: 'ruby',
    Swift: 'swift', Kotlin: 'kotlin', Dart: 'dart', Shell: 'gnubash', Vue: 'vuedotjs', Svelte: 'svelte',
    'Jupyter Notebook': 'jupyter', Lua: 'lua', R: 'r', Dockerfile: 'docker', SCSS: 'sass', MDX: 'mdx',
  },

  // "rgb(227, 76, 38)" ou "#e34c26" -> "e34c26"
  hex(color) {
    if (!color) return '8b949e';
    const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgb) return rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return color.replace('#', '');
  },

  badge(language, color) {
    // Na sintaxe do shields.io, "-" e "_" têm significado: duplicam-se para serem literais.
    const label = encodeURIComponent(language.replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_'));
    const logo = this.LOGOS[language] ? `&logo=${this.LOGOS[language]}&logoColor=white` : '';
    return `![${language}](https://img.shields.io/badge/${label}-${this.hex(color)}?style=flat-square${logo})`;
  },

  // Colunas possíveis na tabela (o nome do projeto está sempre presente).
  COLUMNS: [
    { id: 'description', label: 'Descrição', header: 'Descrição' },
    { id: 'language', label: 'Linguagem', header: 'Linguagem' },
    { id: 'stars', label: 'Estrelas', header: '⭐', align: 'right' },
    { id: 'forks', label: 'Forks', header: 'Forks', align: 'right' },
    { id: 'issues', label: 'Issues abertas', header: 'Issues', align: 'right' },
    { id: 'license', label: 'Licença', header: 'Licença' },
    { id: 'topics', label: 'Tópicos', header: 'Tópicos' },
    { id: 'contributors', label: 'Contribuidores', header: '👥', align: 'right' },
    { id: 'updated', label: 'Última atualização', header: 'Atualizado' },
    { id: 'created', label: 'Data de criação', header: 'Criado' },
    { id: 'homepage', label: 'Website', header: 'Website' },
  ],
  DEFAULT_COLUMNS: ['description', 'language', 'stars'],

  monthYear(iso) {
    return iso ? new Date(iso).toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' }) : '—';
  },

  value(id, repo, meta, languageColor) {
    switch (id) {
      case 'description': return this.cell(repo.description);
      case 'language': return repo.language ? this.badge(repo.language, languageColor(repo)) : '—';
      case 'stars': return String(repo.stars || '—');
      case 'forks': return String(repo.forks || '—');
      case 'issues': return String(repo.openIssues || '—');
      case 'license': return this.cell(repo.license);
      case 'topics': return repo.topics?.length ? repo.topics.map((t) => `\`${t}\``).join(' ') : '—';
      case 'contributors': return meta?.contributors || '—';
      case 'updated': return this.monthYear(repo.updatedAt);
      case 'created': return this.monthYear(repo.createdAt);
      case 'homepage': {
        if (!repo.homepage) return '—';
        const url = /^https?:\/\//.test(repo.homepage) ? repo.homepage : `https://${repo.homepage}`;
        return `[🔗 site](${url})`;
      }
      default: return '—';
    }
  },

  cell(text) {
    return (text || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim() || '—';
  },

  // folders: árvore de pastas (FolderTree); repos: cache com metadados;
  // languageColor: (repo) => cor; meta: contribuidores por repo; columns: ids de COLUMNS
  build(folders, repos, { owner, includePrivate = false, languageColor, date = new Date(), meta = {}, columns = this.DEFAULT_COLUMNS }) {
    const cols = this.COLUMNS.filter((c) => columns.includes(c.id));
    const header = `| Projeto | ${cols.map((c) => c.header).join(' | ')} |`.replace(' |  |', ' |');
    const divider = `| :-- | ${cols.map((c) => (c.align === 'right' ? '--:' : ':--')).join(' | ')} |`.replace(' |  |', ' |');
    const byName = new Map(repos.map((r) => [r.fullName.toLowerCase(), r]));
    const visible = (fullName) => {
      const repo = byName.get(fullName.toLowerCase());
      return includePrivate || !repo?.private;
    };
    const hasContent = (folder) => FolderTree.allRepos(folders, folder).some(visible);

    const lines = [
      this.START,
      '<!-- Gerado pela extensão GitHub Repo Folders. O que escreveres dentro deste bloco é substituído. -->',
      '',
    ];

    const renderFolder = (folder, depth) => {
      if (!hasContent(folder)) return;
      const heading = '#'.repeat(Math.min(3 + depth, 6));
      lines.push(`${heading} ${depth === 0 ? '📁' : '📂'} ${folder.name}`, '');

      const own = folder.repos.filter(visible);
      if (own.length) {
        lines.push(header, divider);
        for (const fullName of own) {
          const repo = byName.get(fullName.toLowerCase()) || { fullName };
          const [o, n] = fullName.split('/');
          const shown = o.toLowerCase() === owner.toLowerCase() ? n : fullName;
          const name = `[**${this.cell(shown)}**](https://github.com/${fullName})${repo.private ? ' 🔒' : ''}`;
          const values = cols.map((c) => this.value(c.id, repo, meta[fullName.toLowerCase()], languageColor));
          lines.push(`| ${[name, ...values].join(' | ')} |`);
        }
        lines.push('');
      }
      for (const child of FolderTree.children(folders, folder.id)) renderFolder(child, depth + 1);
    };
    for (const top of FolderTree.children(folders)) renderFolder(top, 0);

    const day = date.toLocaleDateString('pt-PT');
    lines.push(`<sub>Atualizado a ${day} · organizado com GitHub Repo Folders</sub>`, this.END);
    return lines.join('\n');
  },

  // Substitui o bloco entre os marcadores; se não existir, acrescenta-o no fim.
  apply(readme, section) {
    const start = readme.indexOf(this.START);
    const end = readme.indexOf(this.END, start);
    if (start !== -1 && end !== -1) {
      return { text: readme.slice(0, start) + section + readme.slice(end + this.END.length), appended: false };
    }
    const base = readme.replace(/\s*$/, '');
    return { text: `${base}${base ? '\n\n' : ''}## 📁 Os meus projetos\n\n${section}\n`, appended: true };
  },
};
