const multer = require('multer');
const { importClientsFromSpreadsheet } = require('../services/clientImport.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const ok =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.csv') ||
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      mime === 'text/csv' ||
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/octet-stream';
    cb(ok ? null : new Error('Envie um arquivo .xlsx, .xls ou .csv'), ok);
  },
});

class ClientImportController {
  uploadMiddleware() {
    return (req, res, next) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: err.message || 'Falha no upload da planilha' });
        }
        return next();
      });
    };
  }

  async preview(req, res) {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'Envie o arquivo da planilha de clientes' });
      }

      const result = await importClientsFromSpreadsheet(req.file.buffer, {
        dryRun: true,
        skipExisting: true,
        updateExisting: false,
      });
      return res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[ClientImport.preview]', err);
      return res.status(status).json({ error: err.message || 'Erro ao analisar planilha' });
    }
  }

  async import(req, res) {
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: 'Envie o arquivo da planilha de clientes' });
      }

      const skipExisting =
        req.body?.skipExisting === undefined
          ? true
          : String(req.body.skipExisting) !== 'false' && req.body.skipExisting !== false;

      const updateExisting =
        String(req.body?.updateExisting) === 'true' || req.body?.updateExisting === true;

      const result = await importClientsFromSpreadsheet(req.file.buffer, {
        dryRun: false,
        skipExisting,
        updateExisting,
      });

      return res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[ClientImport.import]', err);
      return res.status(status).json({ error: err.message || 'Erro ao importar clientes' });
    }
  }
}

module.exports = new ClientImportController();
