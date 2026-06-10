const express  = require('express');
const path      = require('path');
const archiver  = require('archiver');
const fs        = require('fs');

const app  = express();
const PORT = 5000;

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── ZIP download route — v10.6.12 ──────────────────────────────────────────
app.get('/download/multiplus-v10.6.12-tab-box-search-fixed.zip', (req, res) => {
  const APP = 'multiplus-v10.6.12-tab-box-search-fixed';

  const FILES = [
    { disk: 'main.js',           zip: `${APP}/main.js` },
    { disk: 'preload.js',        zip: `${APP}/preload.js` },
    { disk: 'fb-preload.js',     zip: `${APP}/fb-preload.js` },
    { disk: 'inject.js',         zip: `${APP}/inject.js` },
    { disk: 'index.html',        zip: `${APP}/index.html` },
    { disk: 'package.json',      zip: `${APP}/package.json` },
    { disk: 'package-lock.json', zip: `${APP}/package-lock.json` },
    { disk: 'icon.png',          zip: `${APP}/icon.png` },
    { disk: 'appicon.png',       zip: `${APP}/appicon.png` },
    { disk: 'server.js',         zip: `${APP}/server.js` },
    { disk: '.github/workflows/build-desktop.yml',
                                 zip: `${APP}/.github/workflows/build-desktop.yml` },
  ];

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="multiplus-v10.6.12-tab-box-search-fixed.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => { console.error('ZIP error:', err); res.destroy(); });
  archive.pipe(res);

  for (const f of FILES) {
    const full = path.join(__dirname, f.disk);
    if (fs.existsSync(full)) {
      archive.file(full, { name: f.zip });
    } else {
      console.warn('ZIP: missing file', f.disk);
    }
  }

  archive.finalize();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Multi Plus v10.6.12 running at http://0.0.0.0:${PORT}`);
});
