const DEFAULT_CHECKOUT_SETTINGS = {
  termsCheckedByDefault: false,
  prefillUserName: true,
  prefillUserEmail: true,
  fields: [
    {
      key: 'name',
      label: 'Nome completo',
      type: 'text',
      placeholder: 'Nome completo',
      required: true,
      enabled: true,
      prefillFromUser: 'name',
    },
    {
      key: 'email',
      label: 'E-mail',
      type: 'email',
      placeholder: 'Seu melhor e-mail',
      required: true,
      enabled: true,
      prefillFromUser: 'email',
    },
    {
      key: 'robloxName',
      label: 'Nome no Roblox',
      type: 'text',
      placeholder: 'Seu usuário no Roblox',
      required: false,
      enabled: true,
      prefillFromUser: null,
    },
  ],
};

function sanitizeCheckoutField(field, index) {
  if (!field || typeof field !== 'object') return null;
  const key = String(field.key || `field_${index + 1}`).trim().slice(0, 40);
  const label = String(field.label || 'Campo').trim().slice(0, 80);
  const type = ['text', 'email', 'tel', 'number'].includes(field.type) ? field.type : 'text';
  const placeholder = field.placeholder ? String(field.placeholder).slice(0, 120) : '';
  const prefillFromUser = ['name', 'email'].includes(field.prefillFromUser)
    ? field.prefillFromUser
    : null;

  return {
    key,
    label,
    type,
    placeholder,
    required: Boolean(field.required),
    enabled: field.enabled !== false,
    prefillFromUser,
  };
}

function normalizeCheckoutSettings(raw) {
  const base = { ...DEFAULT_CHECKOUT_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;

  const fields = Array.isArray(raw.fields) && raw.fields.length
    ? raw.fields.map(sanitizeCheckoutField).filter(Boolean)
    : base.fields;

  return {
    termsCheckedByDefault: Boolean(raw.termsCheckedByDefault),
    prefillUserName: raw.prefillUserName !== false,
    prefillUserEmail: raw.prefillUserEmail !== false,
    fields: fields.length ? fields : base.fields,
  };
}

module.exports = {
  DEFAULT_CHECKOUT_SETTINGS,
  normalizeCheckoutSettings,
};
