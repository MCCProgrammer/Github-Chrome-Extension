// Open the side panel when the extension icon is clicked.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// GitHub's public API, unauthenticated (60 requests/hour). Account data
// (including private repositories) is read from github.com pages with the session.
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
    openIssues: r.open_issues_count, // includes open PRs
    license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : (r.license?.name || ''),
    topics: r.topics || [],
    size: r.size, // KB
    homepage: r.homepage || '',
  };
}

// Data the profile list doesn't show (created date, issues, size…). Public repos only.
async function fetchRepoInfo(fullName) {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`erro ${res.status}`);
  return toRepo(await res.json());
}

// Renders Markdown with GitHub's own engine so the preview is accurate.
async function renderMarkdown(owner, text) {
  const res = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: { ...API_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode: 'gfm', context: `${owner}/${owner}` }),
  });
  if (!res.ok) throw new Error(`erro ${res.status}`);
  return res.text();
}

// Answers async messages as { ...result } or { error }.
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
