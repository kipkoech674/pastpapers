function safeParseUser() {
  const rawUser = localStorage.getItem('campusHubUser');
  if (!rawUser || rawUser === 'undefined' || rawUser === 'null') {
    localStorage.removeItem('campusHubUser');
    return null;
  }

  try {
    const parsed = JSON.parse(rawUser);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    localStorage.removeItem('campusHubUser');
    return null;
  }
}

const state = {
  token: localStorage.getItem('campusHubToken') || '',
  user: safeParseUser(),
  papers: [],
  selectedPaperId: null,
  filters: {
    q: '',
    university: '',
    course: '',
    year: '',
    semester: ''
  }
};

const authSection = document.getElementById('authSection');
const dashboardSection = document.getElementById('dashboardSection');
const authStatus = document.getElementById('authStatus');
const logoutBtn = document.getElementById('logoutBtn');
const paperList = document.getElementById('paperList');
const paperCount = document.getElementById('paperCount');
const bookmarkCount = document.getElementById('bookmarkCount');
const uniCount = document.getElementById('uniCount');
const viewerTitle = document.getElementById('viewerTitle');
const pdfViewer = document.getElementById('pdfViewer');
const bookmarkBtn = document.getElementById('bookmarkBtn');
const downloadBtn = document.getElementById('downloadBtn');
let viewerObjectUrl = '';

function setAuthUI() {
  if (state.token && state.user) {
    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    authStatus.textContent = `Signed in as ${state.user.name}`;
    logoutBtn.classList.remove('hidden');
  } else {
    authSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    authStatus.textContent = 'Not signed in';
    logoutBtn.classList.add('hidden');
  }
}

function persistSession(token, user) {
  localStorage.setItem('campusHubToken', token);
  localStorage.setItem('campusHubUser', JSON.stringify(user));
  state.token = token;
  state.user = user;
  setAuthUI();
}

function clearSession() {
  localStorage.removeItem('campusHubToken');
  localStorage.removeItem('campusHubUser');
  state.token = '';
  state.user = null;
  setAuthUI();
}

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
    'Content-Type': 'application/json'
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || 'Request failed.');
  }

  return result;
}

async function loadPapers() {
  try {
    const params = new URLSearchParams();
    Object.entries(state.filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    const data = await apiRequest(`/api/papers?${params.toString()}`);
    state.papers = data.papers || [];
    renderPaperList();
    renderStats();
    if (!state.selectedPaperId && state.papers.length) {
      selectPaper(state.papers[0].id);
    }
    if (!state.papers.length) {
      paperList.innerHTML = '<div class="paper-card"><h4>No papers found</h4><p class="muted">Try a different keyword or upload a new paper.</p></div>';
      pdfViewer.src = 'about:blank';
      viewerTitle.textContent = 'PDF viewer';
    }
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

function renderStats() {
  const uniqueUniversities = new Set(state.papers.map((paper) => paper.university).filter(Boolean)).size;
  const bookmarks = state.papers.filter((paper) => paper.bookmarked).length;
  paperCount.textContent = String(state.papers.length);
  uniCount.textContent = String(uniqueUniversities);
  bookmarkCount.textContent = String(bookmarks);
}

function renderPaperList() {
  if (!state.papers.length) {
    paperList.innerHTML = '<div class="paper-card"><h4>No papers found</h4><p class="muted">Adjust the filter or upload a new exam paper.</p></div>';
    return;
  }

  paperList.innerHTML = state.papers.map((paper) => `
    <article class="paper-card ${paper.id === state.selectedPaperId ? 'active' : ''}" data-id="${paper.id}">
      <h4>${paper.title}</h4>
      <div class="meta-row">
        <span class="meta-tag">${paper.university}</span>
        <span class="meta-tag">${paper.course}</span>
        <span class="meta-tag">${paper.year}</span>
        <span class="meta-tag">${paper.semester}</span>
      </div>
      <p class="muted">${paper.description || 'No description provided.'}</p>
      <div class="paper-actions">
        <button class="ghost-button" data-action="open" data-id="${paper.id}">Open</button>
        <button class="ghost-button" data-action="bookmark" data-id="${paper.id}">${paper.bookmarked ? 'Saved' : 'Save'}</button>
      </div>
    </article>
  `).join('');

  paperList.querySelectorAll('[data-action="open"]').forEach((button) => {
    button.addEventListener('click', () => selectPaper(Number(button.dataset.id)));
  });

  paperList.querySelectorAll('[data-action="bookmark"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!state.token) {
        alert('Please login to bookmark papers.');
        return;
      }
      await toggleBookmark(Number(button.dataset.id));
    });
  });
}

async function selectPaper(id) {
  state.selectedPaperId = id;
  renderPaperList();

  const selected = state.papers.find((paper) => paper.id === id);
  if (!selected) return;

  viewerTitle.textContent = selected.title;
  downloadBtn.disabled = false;

  if (viewerObjectUrl) {
    URL.revokeObjectURL(viewerObjectUrl);
    viewerObjectUrl = '';
  }

  try {
    const isLocalFile = selected.fileUrl && selected.fileUrl.startsWith('/api/papers/');
    const fileResponse = await fetch(isLocalFile ? selected.fileUrl : selected.fileUrl || 'about:blank', {
      headers: isLocalFile ? { Authorization: `Bearer ${state.token}` } : {}
    });
    if (!fileResponse.ok) {
      throw new Error('The paper file could not be opened.');
    }
    viewerObjectUrl = URL.createObjectURL(await fileResponse.blob());
    pdfViewer.src = viewerObjectUrl;
  } catch (error) {
    pdfViewer.src = 'about:blank';
    alert(error.message);
  }

  if (state.token) {
    const result = await apiRequest(`/api/papers/${id}`);
    const paper = result.paper;
    bookmarkBtn.textContent = paper.bookmarked ? 'Remove bookmark' : 'Bookmark';
  } else {
    bookmarkBtn.textContent = 'Bookmark';
  }
}

async function toggleBookmark(id) {
  if (!state.token) {
    alert('Please login to bookmark papers.');
    return;
  }

  try {
    const result = await apiRequest(`/api/papers/${id}/bookmark`, {
      method: 'POST'
    });

    state.papers = state.papers.map((paper) => paper.id === id ? { ...paper, bookmarked: result.bookmarked } : paper);
    renderPaperList();
    renderStats();
    bookmarkBtn.textContent = result.bookmarked ? 'Remove bookmark' : 'Bookmark';
  } catch (error) {
    alert(error.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Registration failed.');
      }
      return data;
    });

    persistSession(result.token, result.user);
    event.target.reset();
    await loadPapers();
  } catch (error) {
    alert(error.message);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Login failed.');
      }
      return data;
    });

    persistSession(result.token, result.user);
    event.target.reset();
    await loadPapers();
  } catch (error) {
    alert(error.message);
  }
}

async function handleUpload(event) {
  event.preventDefault();
  if (!state.token) {
    alert('Please login before uploading papers.');
    return;
  }

  const form = event.target;
  const formData = new FormData(form);

  try {
    const response = await fetch('/api/papers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`
      },
      body: formData
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || 'Upload failed.');
    }

    form.reset();
    await loadPapers();
    alert('Paper uploaded successfully!');
  } catch (error) {
    alert(error.message);
  }
}

async function handleSearch(event) {
  event.preventDefault();
  state.filters.q = document.getElementById('searchInput').value.trim();
  state.filters.university = document.getElementById('universityFilter').value.trim();
  state.filters.course = document.getElementById('courseFilter').value.trim();
  state.filters.year = document.getElementById('yearFilter').value;
  state.filters.semester = document.getElementById('semesterFilter').value.trim();
  await loadPapers();
}

logoutBtn.addEventListener('click', () => {
  clearSession();
  state.papers = [];
  state.selectedPaperId = null;
  if (viewerObjectUrl) {
    URL.revokeObjectURL(viewerObjectUrl);
    viewerObjectUrl = '';
  }
  renderPaperList();
  pdfViewer.src = 'about:blank';
  viewerTitle.textContent = 'PDF viewer';
  downloadBtn.disabled = true;
});

bookmarkBtn.addEventListener('click', async () => {
  if (!state.selectedPaperId) return;
  await toggleBookmark(state.selectedPaperId);
});

downloadBtn.addEventListener('click', async () => {
  if (!state.selectedPaperId || !state.token) return;

  try {
    const selected = state.papers.find((paper) => paper.id === state.selectedPaperId);
    const isLocalFile = selected?.fileUrl && selected.fileUrl.startsWith('/api/papers/');
    const fileUrl = isLocalFile ? `${selected.fileUrl}?download=1` : selected?.fileUrl;
    const response = await fetch(fileUrl, {
      headers: isLocalFile ? { Authorization: `Bearer ${state.token}` } : {}
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || 'Download failed.');
    }

    const downloadUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = selected?.originalName || 'past-paper.pdf';
    link.click();
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('registerForm').addEventListener('submit', handleRegister);
document.getElementById('loginForm').addEventListener('submit', handleLogin);
document.getElementById('searchForm').addEventListener('submit', handleSearch);
document.getElementById('uploadForm').addEventListener('submit', handleUpload);

setAuthUI();
loadPapers();
