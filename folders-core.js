// Árvore de pastas, partilhada pela página do GitHub (content.js) e pelo painel lateral.
// As pastas são guardadas numa lista simples; cada uma aponta para a mãe com parentId
// (null/ausente = pasta de topo).
const FolderTree = {
  byId(folders, id) {
    return folders.find((f) => f.id === id);
  },

  parentOf(folders, folder) {
    // Uma mãe que já não existe é tratada como topo.
    return folder.parentId ? this.byId(folders, folder.parentId) || null : null;
  },

  children(folders, parentId = null) {
    return folders.filter((f) => (this.parentOf(folders, f)?.id || null) === parentId);
  },

  // ["Universidade projects", "Aed Projects"]
  path(folders, id) {
    const names = [];
    const seen = new Set();
    for (let f = this.byId(folders, id); f && !seen.has(f.id); f = this.parentOf(folders, f)) {
      seen.add(f.id);
      names.unshift(f.name);
    }
    return names;
  },

  isDescendant(folders, id, ancestorId) {
    const seen = new Set();
    for (let f = this.byId(folders, id); f && !seen.has(f.id); f = this.parentOf(folders, f)) {
      if (f.id === ancestorId) return true;
      seen.add(f.id);
    }
    return false;
  },

  // Repositórios da pasta e de todas as subpastas.
  allRepos(folders, folder) {
    return [...folder.repos, ...this.children(folders, folder.id).flatMap((c) => this.allRepos(folders, c))];
  },

  // Lista em ordem de árvore: [{ folder, depth }]
  flatten(folders, parentId = null, depth = 0) {
    return this.children(folders, parentId).flatMap((folder) => [
      { folder, depth },
      ...this.flatten(folders, folder.id, depth + 1),
    ]);
  },

  // Muda a pasta de sítio. Recusa criar ciclos (pôr uma pasta dentro de si própria).
  setParent(folders, id, parentId) {
    if (id === parentId || (parentId && this.isDescendant(folders, parentId, id))) return false;
    const folder = this.byId(folders, id);
    if (!folder) return false;
    folder.parentId = parentId || null;
    // Coloca-a no fim da lista para aparecer como última entre as irmãs.
    folders.splice(folders.indexOf(folder), 1);
    folders.push(folder);
    return true;
  },

  // Apaga uma pasta: subpastas e repositórios sobem para a pasta-mãe
  // (ou, se for de topo, as subpastas passam a topo e os repos ficam sem pasta).
  remove(folders, id) {
    const folder = this.byId(folders, id);
    if (!folder) return folders;
    const parent = this.parentOf(folders, folder);
    for (const c of this.children(folders, id)) c.parentId = parent ? parent.id : null;
    if (parent) parent.repos.push(...folder.repos);
    return folders.filter((f) => f.id !== id);
  },

  // Opções para um <select> "mover para": nomes indentados conforme a profundidade.
  optionLabel(folder, depth) {
    return `${'   '.repeat(depth)}${depth ? '↳ ' : ''}${folder.name}`;
  },
};
