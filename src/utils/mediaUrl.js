function getPublicApiBaseUrl(req) {
  const configured = process.env.API_PUBLIC_URL
    || process.env.PUBLIC_API_URL
    || process.env.BACKEND_URL
    || process.env.API_URL;

  if (configured) {
    return String(configured).replace(/\/$/, '');
  }

  if (req?.get) {
    const host = req.get('host');
    if (host) {
      return `${req.protocol}://${host}`;
    }
  }

  return `http://localhost:${process.env.PORT || 5000}`;
}

function extractCdnFilename(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/\/cdn\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function resolveMediaUrl(url, req) {
  if (!url || typeof url !== 'string') return url;

  const trimmed = url.trim();
  if (!trimmed) return url;

  const publicBase = getPublicApiBaseUrl(req);
  const filename = extractCdnFilename(trimmed);

  if (filename) {
    return `${publicBase}/cdn/${filename}`;
  }

  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname.startsWith('/cdn/')) {
        return `${publicBase}${parsed.pathname}`;
      }
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function resolveMediaUrls(urls, req) {
  if (!Array.isArray(urls)) return urls;
  return urls.map((url) => resolveMediaUrl(url, req));
}

function resolveEntityMedia(entity, req) {
  if (!entity || typeof entity !== 'object') return entity;

  const resolved = Array.isArray(entity) ? [...entity] : { ...entity };

  for (const [key, value] of Object.entries(resolved)) {
    if (Array.isArray(value) && (key === 'gallery' || key === 'images')) {
      resolved[key] = resolveMediaUrls(value, req);
      continue;
    }

    if (typeof value === 'string' && /url|image/i.test(key)) {
      resolved[key] = resolveMediaUrl(value, req);
    }
  }

  return resolved;
}

function buildCdnUrl(filename, req) {
  return `${getPublicApiBaseUrl(req)}/cdn/${filename}`;
}

module.exports = {
  getPublicApiBaseUrl,
  buildCdnUrl,
  extractCdnFilename,
  resolveMediaUrl,
  resolveMediaUrls,
  resolveEntityMedia,
};
