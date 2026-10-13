// Folder tree, shared by the GitHub page (content.js) and the side panel.
// Folders are stored as a flat list; each points to its parent via parentId
// (null/missing = top-level folder).
const FolderTree = {
  byId(folders, id) {
    return folders.find((f) => f.id === id);
  },

  parentOf(folders, folder) {
    // A parent that no longer exists is treated as top level.
    return folder.parentId ? this.byId(folders, folder.parentId) || null : null;
  },

  children(folders, parentId = null) {
    return folders.filter((f) => (this.parentOf(folders, f)?.id || null) === parentId);
  },

  // ["University projects", "Algorithms"]
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

  // Repositories in the folder and all its subfolders.
  allRepos(folders, folder) {
    return [...folder.repos, ...this.children(folders, folder.id).flatMap((c) => this.allRepos(folders, c))];
  },

  // List in tree order: [{ folder, depth }]
  flatten(folders, parentId = null, depth = 0) {
    return this.children(folders, parentId).flatMap((folder) => [
      { folder, depth },
      ...this.flatten(folders, folder.id, depth + 1),
    ]);
  },

  // Moves a folder. Refuses to create cycles (putting a folder inside itself).
  setParent(folders, id, parentId) {
    if (id === parentId || (parentId && this.isDescendant(folders, parentId, id))) return false;
    const folder = this.byId(folders, id);
    if (!folder) return false;
    folder.parentId = parentId || null;
    // Move it to the end of the list so it shows last among its siblings.
    folders.splice(folders.indexOf(folder), 1);
    folders.push(folder);
    return true;
  },

  // Deletes a folder: subfolders and repositories move up to the parent
  // (or, for a top-level folder, subfolders become top-level and repos become unsorted).
  remove(folders, id) {
    const folder = this.byId(folders, id);
    if (!folder) return folders;
    const parent = this.parentOf(folders, folder);
    for (const c of this.children(folders, id)) c.parentId = parent ? parent.id : null;
    if (parent) parent.repos.push(...folder.repos);
    return folders.filter((f) => f.id !== id);
  },

  // Options for a "move to" <select>: names indented by depth.
  optionLabel(folder, depth) {
    return `${'   '.repeat(depth)}${depth ? '↳ ' : ''}${folder.name}`;
  },
};
