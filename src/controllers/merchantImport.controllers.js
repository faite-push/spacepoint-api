const multer = require('multer');
const { importMerchantXml } = require('../services/merchantImport.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const ok =
      name.endsWith('.xml') ||
      mime.includes('xml') ||
      mime === 'application/octet-stream' ||
      mime === 'text/plain';
    cb(ok ? null : new Error('Envie um arquivo .xml do Google Merchant'), ok);
  },
});

function resolveXmlPayload(req) {
  if (req.file?.buffer?.length) {
    return req.file.buffer.toString('utf8');
  }

  if (typeof req.body?.xml === 'string' && req.body.xml.trim()) {
    return req.body.xml;
  }

  return null;
}

class MerchantImportController {
  uploadMiddleware() {
    return (req, res, next) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: err.message || 'Falha no upload do XML' });
        }
        return next();
      });
    };
  }

  async preview(req, res) {
    try {
      const xml = resolveXmlPayload(req);
      if (!xml) {
        return res.status(400).json({ error: 'Envie o arquivo XML do Google Merchant' });
      }

      const result = await importMerchantXml(xml, { dryRun: true });
      return res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[MerchantImport.preview]', err);
      return res.status(status).json({ error: err.message || 'Erro ao analisar XML' });
    }
  }

  async import(req, res) {
    try {
      const xml = resolveXmlPayload(req);
      if (!xml) {
        return res.status(400).json({ error: 'Envie o arquivo XML do Google Merchant' });
      }

      const skipExisting =
        req.body?.skipExisting === undefined
          ? true
          : String(req.body.skipExisting) !== 'false' && req.body.skipExisting !== false;

      const result = await importMerchantXml(xml, {
        dryRun: false,
        skipExisting,
      });

      return res.json(result);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[MerchantImport.import]', err);
      return res.status(status).json({ error: err.message || 'Erro ao importar produtos' });
    }
  }
}

module.exports = new MerchantImportController();
