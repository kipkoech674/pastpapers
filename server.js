const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'campus-papers-hub-secret';

const rootDir = __dirname;
const dataDir = path.join(rootDir, 'data');
const uploadsDir = path.join(rootDir, 'uploads');
const dbFilePath = path.join(dataDir, 'campus_papers.db');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

let db;

function saveDatabase() {
  fs.writeFileSync(dbFilePath, Buffer.from(db.export()));
}

function queryOne(sqlText, params = []) {
  const stmt = db.prepare(sqlText);
  if (Array.isArray(params) && params.length) {
    stmt.bind(params);
  }

  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function queryAll(sqlText, params = []) {
  const stmt = db.prepare(sqlText);
  if (Array.isArray(params) && params.length) {
    stmt.bind(params);
  }

  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function executeWrite(sqlText, params = []) {
  db.run(sqlText, params);
  saveDatabase();
}

function initializeDatabase(SQL) {
  if (fs.existsSync(dbFilePath)) {
    const fileBuffer = fs.readFileSync(dbFilePath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      university TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      university TEXT NOT NULL,
      course TEXT NOT NULL,
      year INTEGER NOT NULL,
      semester TEXT NOT NULL,
      description TEXT,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      uploaded_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      paper_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, paper_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(paper_id) REFERENCES papers(id)
    );
  `);

  saveDatabase();
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    university: user.university
  };
}

function createToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = queryOne('SELECT * FROM users WHERE id = ?', [decoded.sub]);
    if (!user) {
      return res.status(401).json({ message: 'User not found.' });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-');
    const extension = path.extname(safeName) || '.pdf';
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only PDF files are allowed.'));
  }
});

function serializePaper(row, currentUserId) {
  const bookmarked = Number(row.is_bookmarked || 0) === 1;
  return {
    id: row.id,
    title: row.title,
    university: row.university,
    course: row.course,
    year: row.year,
    semester: row.semester,
    description: row.description,
    fileUrl: row.file_url,
    originalName: row.original_name,
    fileName: row.file_name,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
    bookmarked: currentUserId ? bookmarked : false
  };
}

function seedSampleData() {
  const demoUser = queryOne('SELECT * FROM users WHERE email = ?', ['demo@campuspapers.app']);
  if (!demoUser) {
    const hashedPassword = bcrypt.hashSync('demo123', 10);
    executeWrite(
      'INSERT INTO users (name, email, password, university) VALUES (?, ?, ?, ?)',
      ['Demo Student', 'demo@campuspapers.app', hashedPassword, 'University of Nairobi']
    );
  }

  const paperCountRow = queryOne('SELECT COUNT(*) AS total FROM papers');
  if (paperCountRow && Number(paperCountRow.total) > 0) {
    return;
  }

  const userId = queryOne('SELECT id FROM users WHERE email = ?', ['demo@campuspapers.app']).id;
  const samplePapers = [
    {
      title: 'Introduction to Computer Systems 2024',
      university: 'University of Nairobi',
      course: 'Computer Science',
      year: 2024,
      semester: 'Semester 1',
      description: 'Past paper for the introductory systems course.',
      fileUrl: 'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf',
      originalName: 'Computer-Systems-2024.pdf'
    },
    {
      title: 'Business Finance Final Exam',
      university: 'Kenyatta University',
      course: 'Business Administration',
      year: 2023,
      semester: 'Semester 2',
      description: 'Finance past paper with practical problem solving questions.',
      fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      originalName: 'Business-Finance-2023.pdf'
    },
    {
      title: 'Engineering Mathematics II',
      university: 'Jomo Kenyatta University of Agriculture and Technology',
      course: 'Mechanical Engineering',
      year: 2022,
      semester: 'Semester 1',
      description: 'Calculus and differential equations revision paper.',
      fileUrl: 'https://www.orimi.com/pdf-test.pdf',
      originalName: 'Engineering-Maths-II.pdf'
    }
  ];

  samplePapers.forEach((paper) => {
    executeWrite(
      `INSERT INTO papers (title, university, course, year, semester, description, file_name, original_name, file_url, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paper.title,
        paper.university,
        paper.course,
        paper.year,
        paper.semester,
        paper.description,
        `${paper.originalName.replace(/\s+/g, '-')}`,
        paper.originalName,
        paper.fileUrl,
        userId
      ]
    );
  });
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(rootDir, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'Campus Past Papers Hub is online.' });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, university } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }

  const existing = queryOne('SELECT id FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (existing) {
    return res.status(409).json({ message: 'An account with that email already exists.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  executeWrite(
    'INSERT INTO users (name, email, password, university) VALUES (?, ?, ?, ?)',
    [name.trim(), String(email).trim().toLowerCase(), hashedPassword, university ? String(university).trim() : '']
  );

  const createdUser = queryOne('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  const token = createToken(createdUser);

  res.status(201).json({
    token,
    user: sanitizeUser(createdUser)
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const user = queryOne('SELECT * FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  res.json({
    token: createToken(user),
    user: sanitizeUser(user)
  });
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/papers', (req, res) => {
  const { q, university, course, year, semester } = req.query;
  let userId = null;

  if (req.headers.authorization) {
    try {
      const decoded = jwt.decode(req.headers.authorization.split(' ')[1]);
      userId = decoded && decoded.sub ? decoded.sub : null;
    } catch (_error) {
      userId = null;
    }
  }

  let query = `
    SELECT p.*, u.name AS uploaded_by_name,
      CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS is_bookmarked
    FROM papers p
    LEFT JOIN users u ON u.id = p.uploaded_by
    LEFT JOIN bookmarks b ON b.paper_id = p.id AND b.user_id = ?
    WHERE 1 = 1
  `;

  const params = [userId || 0];

  if (q) {
    query += ' AND (LOWER(p.title) LIKE ? OR LOWER(p.course) LIKE ? OR LOWER(p.university) LIKE ? OR LOWER(p.description) LIKE ?)';
    const term = `%${String(q).trim().toLowerCase()}%`;
    params.push(term, term, term, term);
  }

  if (university) {
    query += ' AND LOWER(p.university) LIKE ?';
    params.push(`%${String(university).trim().toLowerCase()}%`);
  }

  if (course) {
    query += ' AND LOWER(p.course) LIKE ?';
    params.push(`%${String(course).trim().toLowerCase()}%`);
  }

  if (year) {
    query += ' AND p.year = ?';
    params.push(Number(year));
  }

  if (semester) {
    query += ' AND LOWER(p.semester) LIKE ?';
    params.push(`%${String(semester).trim().toLowerCase()}%`);
  }

  query += ' ORDER BY p.created_at DESC';

  const rows = queryAll(query, params);
  res.json({ papers: rows.map((row) => serializePaper(row, userId)) });
});

app.post('/api/papers', authRequired, (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      return res.status(400).json({ message: error.message || 'Could not upload the paper.' });
    }

    const { title, university, course, year, semester, description } = req.body;
    if (!title || !university || !course || !year || !semester || !req.file) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Title, university, course, year, semester and PDF file are required.' });
    }

    const numericYear = Number(year);
    if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Year must be a whole number between 2000 and 2100.' });
    }

    executeWrite(
      `INSERT INTO papers (title, university, course, year, semester, description, file_name, original_name, file_url, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        university.trim(),
        course.trim(),
        numericYear,
        semester.trim(),
        description ? description.trim() : '',
        req.file.filename,
        req.file.originalname,
        '',
        req.user.id
      ]
    );

    const savedPaper = queryOne('SELECT * FROM papers WHERE file_name = ?', [req.file.filename]);
    const fileUrl = `/api/papers/${savedPaper.id}/file`;
    executeWrite('UPDATE papers SET file_url = ? WHERE id = ?', [fileUrl, savedPaper.id]);
    savedPaper.file_url = fileUrl;
    res.status(201).json({
      paper: {
        ...savedPaper,
        fileUrl: savedPaper.file_url,
        originalName: savedPaper.original_name,
        bookmarked: false
      }
    });
  });
});

app.get('/api/papers/:id/file', authRequired, (req, res) => {
  const paper = queryOne('SELECT * FROM papers WHERE id = ?', [Number(req.params.id)]);
  if (!paper) {
    return res.status(404).json({ message: 'Paper not found.' });
  }

  const filePath = path.resolve(uploadsDir, paper.file_name);
  if (!filePath.startsWith(`${path.resolve(uploadsDir)}${path.sep}`) || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'The paper file is unavailable.' });
  }

  const safeDownloadName = paper.original_name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeDownloadName}"`);
  res.sendFile(filePath);
});

app.get('/api/papers/:id', authRequired, (req, res) => {
  const paper = queryOne('SELECT * FROM papers WHERE id = ?', [Number(req.params.id)]);
  if (!paper) {
    return res.status(404).json({ message: 'Paper not found.' });
  }

  const bookmarked = !!queryOne('SELECT 1 AS found FROM bookmarks WHERE user_id = ? AND paper_id = ?', [req.user.id, paper.id]);
  res.json({
    paper: { ...paper, fileUrl: paper.file_url, originalName: paper.original_name, bookmarked }
  });
});

app.get('/api/bookmarks', authRequired, (req, res) => {
  const rows = queryAll(`
    SELECT p.*, u.name AS uploaded_by_name
    FROM bookmarks b
    JOIN papers p ON p.id = b.paper_id
    LEFT JOIN users u ON u.id = p.uploaded_by
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC
  `, [req.user.id]);

  res.json({
    papers: rows.map((row) => ({
      ...row,
      fileUrl: row.file_url,
      originalName: row.original_name,
      bookmarked: true
    }))
  });
});

app.post('/api/papers/:id/bookmark', authRequired, (req, res) => {
  const paperId = Number(req.params.id);
  const paper = queryOne('SELECT id FROM papers WHERE id = ?', [paperId]);
  if (!paper) {
    return res.status(404).json({ message: 'Paper not found.' });
  }

  const existing = queryOne('SELECT id FROM bookmarks WHERE user_id = ? AND paper_id = ?', [req.user.id, paperId]);
  if (existing) {
    executeWrite('DELETE FROM bookmarks WHERE user_id = ? AND paper_id = ?', [req.user.id, paperId]);
    return res.json({ bookmarked: false, message: 'Bookmark removed.' });
  }

  executeWrite('INSERT INTO bookmarks (user_id, paper_id) VALUES (?, ?)', [req.user.id, paperId]);
  res.json({ bookmarked: true, message: 'Paper bookmarked.' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(rootDir, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

async function startServer() {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  initializeDatabase(SQL);
  seedSampleData();

  app.listen(PORT, () => {
    console.log(`Campus Past Papers Hub is running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
