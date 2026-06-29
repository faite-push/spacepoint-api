/**
 * Extrai texto plano de documento Tiptap/ProseMirror JSON.
 */
function tiptapToPlainText(doc) {
  if (!doc) return '';
  if (typeof doc === 'string') return doc.trim();

  const parts = [];

  function walk(node, blockEnd = false) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text);
    }
    if (node.type === 'hardBreak') {
      parts.push('\n');
    }

    if (Array.isArray(node.content)) {
      node.content.forEach((child, idx) => {
        walk(child);
        if (child.type === 'paragraph' || child.type === 'heading' || child.type === 'listItem') {
          if (idx < node.content.length - 1) parts.push('\n');
        }
      });
    }

    if (blockEnd && ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote'].includes(node.type)) {
      parts.push('\n');
    }
  }

  walk(doc);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { tiptapToPlainText };
