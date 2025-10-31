const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Uploads directory (one level up from this file)
const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');

// Ensure upload dir exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the front-end (index.html) and static assets from this folder
app.use(express.static(path.join(__dirname)));

// Optional: provide a simple root route to serve index.html when visiting /
app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper to safely resolve paths inside the uploads directory
function resolveSafe(relPath = '') {
	const safe = path.normalize(relPath).replace(/^\/*/, '');
	const resolved = path.resolve(UPLOAD_DIR, safe);
	if (!resolved.startsWith(UPLOAD_DIR)) throw new Error('Invalid path');
	return resolved;
}

// Multer storage that writes into the specified folder (folder provided in form field)
const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		try {
			const folder = req.body.folder || '';
			const dest = resolveSafe(folder);
			fs.mkdirSync(dest, { recursive: true });
			cb(null, dest);
		} catch (err) {
			cb(err);
		}
	},
	filename: (req, file, cb) => {
		cb(null, file.originalname);
	}
});

const upload = multer({ storage });

// List files in a folder
app.get('/api/files', async (req, res) => {
	try {
		const folder = req.query.folder || '';
		const dir = resolveSafe(folder);

		// If directory doesn't exist, return empty
		if (!fs.existsSync(dir)) return res.json([]);

		const items = await fs.promises.readdir(dir, { withFileTypes: true });

		const results = await Promise.all(items.map(async (item) => {
			const full = path.join(dir, item.name);
			const stat = await fs.promises.stat(full);
			const relPath = path.relative(UPLOAD_DIR, full).split(path.sep).join('/');

			return {
				name: item.name,
				path: relPath,
				isDirectory: item.isDirectory(),
				size: stat.size,
				type: item.isDirectory() ? '' : path.extname(item.name).replace('.', ''),
				modified: stat.mtime
			};
		}));

		res.json(results);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Failed to list files' });
	}
});

// Upload file
app.post('/api/upload', upload.single('file'), (req, res) => {
	if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
	res.json({ ok: true });
});

// Create folder
app.post('/api/folder', (req, res) => {
	try {
		const { name, parent = '' } = req.body;
		if (!name) return res.status(400).json({ error: 'Missing folder name' });

		const newDir = resolveSafe(path.posix.join(parent || '', name));
		fs.mkdirSync(newDir, { recursive: true });
		res.json({ ok: true });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Failed to create folder' });
	}
});

// Download file (wildcard)
app.get('/api/download/*', (req, res) => {
	try {
		const rel = req.params[0] || '';
		const filePath = resolveSafe(rel);
		if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return res.status(404).send('Not found');
		res.download(filePath);
	} catch (err) {
		console.error(err);
		res.status(400).send('Invalid path');
	}
});

// Delete file or folder
app.delete('/api/delete/*', async (req, res) => {
	try {
		const rel = req.params[0] || '';
		const target = resolveSafe(rel);
		if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });

		const stat = await fs.promises.stat(target);
		if (stat.isDirectory()) {
			await fs.promises.rm(target, { recursive: true, force: true });
		} else {
			await fs.promises.unlink(target);
		}

		res.json({ ok: true });
	} catch (err) {
		console.error(err);
		res.status(400).json({ error: 'Failed to delete' });
	}
});

// Rename
app.put('/api/rename', async (req, res) => {
	try {
		const { oldPath, newName } = req.body;
		if (!oldPath || !newName) return res.status(400).json({ error: 'Missing parameters' });

		const oldFull = resolveSafe(oldPath);
		if (!fs.existsSync(oldFull)) return res.status(404).json({ error: 'Not found' });

		const dir = path.dirname(oldFull);
		const newFull = path.join(dir, newName);
		if (!newFull.startsWith(UPLOAD_DIR)) return res.status(400).json({ error: 'Invalid new name' });

		await fs.promises.rename(oldFull, newFull);
		res.json({ ok: true });
	} catch (err) {
		console.error(err);
		res.status(400).json({ error: 'Failed to rename' });
	}
});

// Search (simple recursive search)
app.get('/api/search', async (req, res) => {
	try {
		const q = (req.query.q || '').toLowerCase().trim();
		if (!q) return res.json([]);

		const results = [];

		async function walk(dir) {
			const items = await fs.promises.readdir(dir, { withFileTypes: true });
			for (const item of items) {
				const full = path.join(dir, item.name);
				const relPath = path.relative(UPLOAD_DIR, full).split(path.sep).join('/');
				if (item.name.toLowerCase().includes(q)) {
					const stat = await fs.promises.stat(full);
					results.push({
						name: item.name,
						path: relPath,
						isDirectory: item.isDirectory(),
						size: stat.size,
						type: item.isDirectory() ? '' : path.extname(item.name).replace('.', ''),
						modified: stat.mtime
					});
				}
				if (item.isDirectory()) await walk(full);
			}
		}

		await walk(UPLOAD_DIR);
		res.json(results);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: 'Search failed' });
	}
});

// Start
app.listen(PORT, () => {
	console.log(`File management API listening on http://localhost:${PORT}`);
});

