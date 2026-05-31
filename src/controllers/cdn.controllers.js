const mime = require('mime-types');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { createReadStream } = require('fs');
const sharp = require('sharp');

const UPLOAD_DIR = path.join(__dirname, '../', 'cdn');

(async () => {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch (err) {
    console.error('Erro ao criar diretório CDN:', err);
  };
})();

class CdnController {
  async getFile(req, res) {
    try {
      const { filename } = req.params;
      if (!filename || filename.includes('..') || filename.includes('/')) {
        return res.status(400).json({ error: 'Nome de arquivo inválido' });
      };

      const filePath = path.join(UPLOAD_DIR, filename);
      if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
        return res.status(403).json({ error: 'Acesso negado' });
      };

      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      };

      const mimeType = mime.lookup(filePath) || 'application/octet-stream';

      res.set({
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'ETag': `"${crypto.createHash('md5').update(stat.mtimeMs + '_' + stat.size).digest('hex')}"`,
      });

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

        if (start >= stat.size || end >= stat.size || start > end) {
          res.set('Content-Range', `bytes */${stat.size}`);
          return res.status(416).end();
        };

        res.status(206);
        res.set({
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });

        return createReadStream(filePath, { start, end }).pipe(res);
      };

      res.set('Content-Length', stat.size);
      createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error('Erro no CDN GET:', err);
      res.status(500).json({ error: 'Erro interno do servidor' });
    };
  };

  async uploadFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      };

      const type = req.body.type || 'general';
      const originalName = req.file.originalname || 'file';
      
      const filename = crypto.randomUUID() + '.webp';
      const finalPath = path.join(UPLOAD_DIR, filename);

      let imageProcessor = sharp(req.file.path);

      if (type === 'banner') {
        // Banners require very high width and premium quality
        imageProcessor = imageProcessor
          .resize(2560, 1080, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 95 });
      } else if (type === 'product') {
        // Products require high quality but smaller footprint
        imageProcessor = imageProcessor
          .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 90 });
      } else {
        // Default avatar/general behavior
        imageProcessor = imageProcessor
          .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 });
      }

      await imageProcessor.toFile(finalPath);
      
      await fs.unlink(req.file.path).catch(() => { });

      const url = `${req.protocol}://${req.get('host')}/cdn/${filename}`;
      const stat = await fs.stat(finalPath);

      res.status(201).json({
        success: true,
        url,
        filename,
        originalName,
        size: stat.size,
        mimetype: 'image/webp',
      });
    } catch (err) {
      console.error('Erro no upload CDN:', err);
      
      if (req.file && req.file.path) {
        await fs.unlink(req.file.path).catch(() => { });
      }
      res.status(500).json({ error: 'Falha ao salvar o arquivo' });
    };
  };

  async deleteFile(req, res) {
    try {
      const { filename } = req.params;
      if (!filename) {
        return res.status(400).json({ error: 'Filename é obrigatório' });
      };

      const filePath = path.join(UPLOAD_DIR, filename);
      if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
        return res.status(403).json({ error: 'Acesso negado' });
      };

      await fs.unlink(filePath);
      res.json({ success: true, message: 'Arquivo excluído com sucesso' });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      };
      console.error('Erro ao deletar arquivo:', err);
      res.status(500).json({ error: 'Erro ao excluir arquivo' });
    };
  };

  async deleteFileInternal(filename) {
    try {
      if (!filename) return false;

      const filePath = path.join(UPLOAD_DIR, filename);
      if (!filePath.startsWith(UPLOAD_DIR + path.sep)) return false;

      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`Erro ao deletar arquivo interno ${filename}:`, err);
      }
      return false;
    }
  }
};

module.exports = new CdnController();