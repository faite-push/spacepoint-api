const DEFAULT_CHECKOUT_FIELDS = [
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
    key: 'cpf',
    label: 'CPF',
    type: 'cpf',
    placeholder: '000.000.000-00',
    required: false,
    enabled: true,
    prefillFromUser: null,
  },
  {
    key: 'phone',
    label: 'Celular',
    type: 'tel',
    placeholder: '(00) 00000-0000',
    required: false,
    enabled: true,
    prefillFromUser: null,
  },
];

const DEFAULT_DELIVERY_OPTIONS = {
  enabled: true,
  standardLabel: 'Entrega padrão',
  standardDescription: 'Processamento normal do pedido',
  expressLabel: 'Entrega expressa',
  expressDescription: 'Prioridade no atendimento e entrega mais rápida',
  expressFeeCents: 999,
};

const DEFAULT_CHECKOUT_SETTINGS = {
  termsCheckedByDefault: false,
  prefillUserName: true,
  prefillUserEmail: true,
  authMode: 'inline_at_payment',
  fields: DEFAULT_CHECKOUT_FIELDS,
  deliveryOptions: DEFAULT_DELIVERY_OPTIONS,
};

function sanitizeAuthMode(value) {
  return value === 'login_before_checkout' ? 'login_before_checkout' : 'inline_at_payment';
}

function sanitizeCheckoutField(field, index) {
  if (!field || typeof field !== 'object') return null;
  const key = String(field.key || `field_${index + 1}`).trim().slice(0, 40);
  const label = String(field.label || 'Campo').trim().slice(0, 80);
  const type = ['text', 'email', 'tel', 'number', 'cpf'].includes(field.type) ? field.type : 'text';
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

function sanitizeDeliveryOptions(raw) {
  const base = { ...DEFAULT_DELIVERY_OPTIONS };
  if (!raw || typeof raw !== 'object') return base;

  return {
    enabled: raw.enabled !== false,
    standardLabel: String(raw.standardLabel || base.standardLabel).slice(0, 80),
    standardDescription: String(raw.standardDescription || base.standardDescription).slice(0, 200),
    expressLabel: String(raw.expressLabel || base.expressLabel).slice(0, 80),
    expressDescription: String(raw.expressDescription || base.expressDescription).slice(0, 200),
    expressFeeCents: Math.max(0, Math.min(999999, Number(raw.expressFeeCents) || base.expressFeeCents)),
  };
}

function ensureDefaultFields(fields) {
  const list = Array.isArray(fields) ? [...fields] : [];
  const keys = new Set(list.map((f) => f.key));

  for (const def of DEFAULT_CHECKOUT_FIELDS) {
    if (!keys.has(def.key)) {
      list.push({ ...def });
    }
  }

  return list.length ? list : DEFAULT_CHECKOUT_FIELDS.map((f) => ({ ...f }));
}

function normalizeCheckoutSettings(raw) {
  const base = { ...DEFAULT_CHECKOUT_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;

  const mergedFields = ensureDefaultFields(
    Array.isArray(raw.fields) && raw.fields.length
      ? raw.fields.map(sanitizeCheckoutField).filter(Boolean)
      : base.fields
  );

  return {
    termsCheckedByDefault: Boolean(raw.termsCheckedByDefault),
    prefillUserName: raw.prefillUserName !== false,
    prefillUserEmail: raw.prefillUserEmail !== false,
    authMode: sanitizeAuthMode(raw.authMode),
    fields: mergedFields,
    deliveryOptions: sanitizeDeliveryOptions(raw.deliveryOptions),
  };
}

function stripCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

function stripPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Persiste CPF e celular no perfil do usuário a partir do checkout.
 * Mantém histórico no pedido (checkoutData) e espelha no cadastro do cliente.
 */
async function syncUserProfileFromCheckout(tx, userId, checkoutData) {
  const data = checkoutData && typeof checkoutData === 'object' ? checkoutData : {};
  const document = stripCpf(data.cpf);
  const phone = stripPhone(data.phone);
  const name = String(data.name || '').trim();

  const update = {};
  if (name) update.name = name.slice(0, 120);
  if (document.length === 11) update.document = document;
  if (phone.length >= 10 && phone.length <= 13) update.phone = phone;

  if (!Object.keys(update).length) return null;

  return tx.user.update({
    where: { id: userId },
    data: update,
  });
}

function isValidCpf(value) {
  const cpf = stripCpf(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === Number(cpf[10]);
}

function resolveEffectiveCheckoutFields(checkoutSettings, requiredFieldKeys = []) {
  const settings = normalizeCheckoutSettings(checkoutSettings);
  const required = new Set(requiredFieldKeys.filter(Boolean));

  const fields = settings.fields.map((field) => {
    const forced = required.has(field.key);
    return {
      ...field,
      enabled: field.enabled || forced,
      required: field.required || forced,
    };
  });

  for (const key of required) {
    if (!fields.some((f) => f.key === key)) {
      const fallback = DEFAULT_CHECKOUT_FIELDS.find((f) => f.key === key);
      if (fallback) {
        fields.push({ ...fallback, enabled: true, required: true });
      }
    }
  }

  return { ...settings, fields };
}

function validateCheckoutData(checkoutSettings, checkoutData, requiredFieldKeys = []) {
  const { fields } = resolveEffectiveCheckoutFields(checkoutSettings, requiredFieldKeys);
  const data = checkoutData && typeof checkoutData === 'object' ? checkoutData : {};
  const errors = [];

  for (const field of fields.filter((f) => f.enabled)) {
    const value = String(data[field.key] ?? '').trim();
    if (field.required && !value) {
      errors.push(`${field.label} é obrigatório`);
      continue;
    }
    if (!value) continue;

    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push(`${field.label} inválido`);
    }
    if (field.key === 'cpf' || field.type === 'cpf') {
      if (!isValidCpf(value)) errors.push('CPF inválido');
    }
  }

  return errors;
}

function resolveCustomerFromOrder(order) {
  const data = order?.checkoutData && typeof order.checkoutData === 'object' ? order.checkoutData : {};

  return {
    customerName: String(data.name || order?.user?.name || 'Cliente').trim(),
    customerEmail: String(data.email || order?.user?.email || 'cliente@spacepoint.com').trim(),
    customerCpf: stripCpf(data.cpf),
    customerPhone: stripPhone(data.phone),
  };
}

module.exports = {
  DEFAULT_CHECKOUT_SETTINGS,
  DEFAULT_CHECKOUT_FIELDS,
  DEFAULT_DELIVERY_OPTIONS,
  normalizeCheckoutSettings,
  resolveEffectiveCheckoutFields,
  validateCheckoutData,
  resolveCustomerFromOrder,
  syncUserProfileFromCheckout,
  stripCpf,
  stripPhone,
  isValidCpf,
};
