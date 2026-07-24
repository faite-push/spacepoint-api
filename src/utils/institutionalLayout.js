/** Layouts estruturados para páginas institucionais (help + document). */

const { sanitizeString } = require('./sanitize');

const HELP_SLUGS = new Set([
  'support',
  'fale-conosco',
  'como-comprar',
  'como-funciona',
  'envio-expresso',
]);

const DOCUMENT_SLUGS = new Set(['about', 'terms', 'privacy', 'cookies', 'refunds']);

const DEFAULT_HOURS = {
  title: 'Horário de Atendimento',
  weekdays: 'Segunda a Sexta: 09:00 - 18:00',
  weekend: 'Finais de Semana: Suporte limitado',
  timezone: 'Horário de Brasília (UTC-3)',
};

const DEFAULT_CHANNELS = [
  {
    id: 'chat',
    icon: 'message-circle',
    title: 'Chat ao Vivo',
    description: 'Converse com nossa equipe em tempo real',
    responseTime: 'Respondemos em 5 min',
    features: [
      'Dúvidas rápidas e pré-venda',
      'Status do pedido e entrega digital',
      'Suporte comercial',
    ],
    ctaLabel: 'Iniciar Chat',
    ctaAction: 'chat',
    ctaHref: '',
  },
  {
    id: 'discord',
    icon: 'discord',
    title: 'Suporte via Discord',
    description: 'Abra um ticket no nosso servidor Discord',
    responseTime: 'Respondemos em 30 min',
    features: [
      'Suporte técnico avançado',
      'Problemas com código ou ativação',
      'Acompanhamento de chamados',
    ],
    ctaLabel: 'Abrir Ticket no Discord',
    ctaAction: 'link',
    ctaHref: 'https://discord.gg/spacepoint',
  },
];

const DEFAULT_FAQ_SUPPORT = [
  {
    question: 'Como recebo meu produto digital?',
    answer:
      'Após a confirmação do pagamento, o código ou as instruções ficam disponíveis em Minha Conta → Meus Pedidos. Em alguns casos, o suporte envia orientação pelo chat do pedido.',
  },
  {
    question: 'O código não funciona. O que faço?',
    answer:
      'Não tente ativar o código em várias contas. Abra o chat do pedido, envie um print do erro e aguarde nosso atendimento. Consulte também a Política de Trocas e Devoluções.',
  },
  {
    question: 'Quais formas de pagamento aceitam?',
    answer:
      'As opções disponíveis aparecem no checkout (ex.: PIX e cartão). O pedido só é processado após a aprovação do pagamento.',
  },
  {
    question: 'Posso pedir reembolso?',
    answer:
      'Produtos digitais têm regras específicas. Em geral, após a revelação/uso da chave não há arrependimento, salvo falhas de entrega ou produto divergente. Veja a página de Trocas e Devoluções.',
  },
];

function defaultHelpLayout(slug) {
  const bySlug = {
    support: {
      heroTitle: 'Como podemos te ajudar?',
      heroSubtitle:
        'Nossa equipe está pronta para resolver seu problema. Escolha o canal ideal abaixo.',
      faq: DEFAULT_FAQ_SUPPORT,
    },
    'fale-conosco': {
      heroTitle: 'Fale Conosco',
      heroSubtitle:
        'Prefere falar com a gente direto? Use o chat ao vivo ou abra um ticket no Discord.',
      faq: [
        {
          question: 'Qual o canal mais rápido?',
          answer:
            'O chat ao vivo costuma ser o mais rápido para dúvidas rápidas e pré-venda. Para problemas técnicos com pedido, o Discord ou o chat do pedido também funcionam bem.',
        },
        {
          question: 'Preciso do número do pedido?',
          answer:
            'Sim, sempre que possível. Tenha o e-mail da compra e prints do problema — isso agiliza bastante o atendimento.',
        },
        ...DEFAULT_FAQ_SUPPORT.slice(0, 2),
      ],
    },
    'como-comprar': {
      heroTitle: 'Como comprar na Space Point',
      heroSubtitle:
        'Passo a passo simples para adquirir seus jogos digitais com segurança.',
      faq: [
        {
          question: 'Preciso criar uma conta?',
          answer:
            'Sim. A conta permite acompanhar pedidos, receber códigos e abrir suporte vinculado à compra.',
        },
        {
          question: 'Como escolho a plataforma certa?',
          answer:
            'Confira no anúncio a plataforma (ex.: PlayStation), a região/conta exigida e a descrição antes de adicionar ao carrinho.',
        },
        {
          question: 'Quando o pagamento é confirmado?',
          answer:
            'Assim que o gateway aprovar (PIX, cartão etc.). Enquanto estiver pendente, acompanhe em Meus Pedidos.',
        },
      ],
    },
    'como-funciona': {
      heroTitle: 'Como funciona a Space Point',
      heroSubtitle:
        'Entenda o fluxo de pagamento, entrega digital e ativação do seu produto.',
      faq: [
        {
          question: 'A entrega é física?',
          answer:
            'Não. Tudo é digital: você recebe código, chave ou instruções online após o pagamento.',
        },
        {
          question: 'Onde vejo o código?',
          answer:
            'Em Minha Conta → Meus Pedidos → detalhe do pedido. Quando necessário, também no chat do pedido.',
        },
        {
          question: 'E se houver atraso?',
          answer:
            'Pedidos em análise antifraude ou pagamento pendente podem demorar mais. Se o prazo passar, fale conosco pelo chat do pedido.',
        },
      ],
    },
    'envio-expresso': {
      heroTitle: 'Envio Expresso',
      heroSubtitle:
        'Entrega digital prioritária assim que o pagamento é confirmado e há estoque disponível.',
      faq: [
        {
          question: 'O que é Envio Expresso?',
          answer:
            'É o fluxo de liberação rápida do código/instruções após a confirmação do pagamento, para itens com estoque disponível.',
        },
        {
          question: 'Sempre é instantâneo?',
          answer:
            'Depende da disponibilidade e da aprovação do pagamento. Análises antifraude podem aumentar o prazo.',
        },
        {
          question: 'Onde encontro o produto entregue?',
          answer:
            'No detalhe do pedido na sua conta. Se precisar de ajuda, use o chat do pedido ou os canais abaixo.',
        },
      ],
    },
  };

  const specific = bySlug[slug] || bySlug.support;
  return {
    heroTitle: specific.heroTitle,
    heroSubtitle: specific.heroSubtitle,
    channels: DEFAULT_CHANNELS.map((c) => ({ ...c, features: [...c.features] })),
    faq: specific.faq.map((f) => ({ ...f })),
    hours: { ...DEFAULT_HOURS },
  };
}

function defaultDocumentLayout(slug) {
  const bySlug = {
    about: {
      eyebrow: 'Empresa',
      intro:
        'Conheça a Space Point BR LTDA — loja brasileira de jogos digitais para PlayStation.',
      showToc: false,
      updatedLabel: '',
    },
    terms: {
      eyebrow: 'Empresa',
      intro: 'Termos de uso e condições de compra da loja Space Point.',
      showToc: true,
      updatedLabel: 'Atualizado periodicamente — versão vigente nesta página.',
    },
    privacy: {
      eyebrow: 'Privacidade',
      intro: 'Como coletamos, usamos e protegemos seus dados pessoais (LGPD).',
      showToc: true,
      updatedLabel: 'Atualizado periodicamente — versão vigente nesta página.',
    },
    cookies: {
      eyebrow: 'Privacidade',
      intro: 'Como utilizamos cookies e tecnologias semelhantes neste site.',
      showToc: true,
      updatedLabel: 'Atualizado periodicamente — versão vigente nesta página.',
    },
    refunds: {
      eyebrow: 'Políticas',
      intro: 'Regras de troca, reembolso e garantia para produtos digitais.',
      showToc: true,
      updatedLabel: 'Atualizado periodicamente — versão vigente nesta página.',
    },
  };
  return { ...(bySlug[slug] || bySlug.about) };
}

function resolveLayoutType(slug, explicit) {
  if (explicit === 'help' || explicit === 'document') return explicit;
  if (HELP_SLUGS.has(slug)) return 'help';
  if (DOCUMENT_SLUGS.has(slug)) return 'document';
  return null;
}

function sanitizeChannel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ctaAction = raw.ctaAction === 'link' ? 'link' : 'chat';
  const features = Array.isArray(raw.features)
    ? raw.features.map((f) => sanitizeString(String(f || ''), 120)).filter(Boolean).slice(0, 8)
    : [];
  return {
    id: sanitizeString(String(raw.id || ''), 40) || `ch-${Math.random().toString(36).slice(2, 8)}`,
    icon: sanitizeString(String(raw.icon || 'message-circle'), 40) || 'message-circle',
    title: sanitizeString(String(raw.title || ''), 80),
    description: sanitizeString(String(raw.description || ''), 200),
    responseTime: sanitizeString(String(raw.responseTime || ''), 80),
    features,
    ctaLabel: sanitizeString(String(raw.ctaLabel || ''), 60) || 'Saiba mais',
    ctaAction,
    ctaHref: sanitizeString(String(raw.ctaHref || ''), 500),
  };
}

function sanitizeFaqItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const question = sanitizeString(String(raw.question || ''), 200);
  const answer = sanitizeString(String(raw.answer || ''), 2000);
  if (!question || !answer) return null;
  return { question, answer };
}

function sanitizeHelpLayout(raw, slug) {
  const fallback = defaultHelpLayout(slug);
  const src = raw && typeof raw === 'object' ? raw : {};
  const channels = Array.isArray(src.channels)
    ? src.channels.map(sanitizeChannel).filter((c) => c && c.title).slice(0, 6)
    : fallback.channels;
  const faq = Array.isArray(src.faq)
    ? src.faq.map(sanitizeFaqItem).filter(Boolean).slice(0, 20)
    : fallback.faq;
  const hoursSrc = src.hours && typeof src.hours === 'object' ? src.hours : {};
  return {
    heroTitle: sanitizeString(String(src.heroTitle || ''), 120) || fallback.heroTitle,
    heroSubtitle: sanitizeString(String(src.heroSubtitle || ''), 400) || fallback.heroSubtitle,
    channels: channels.length ? channels : fallback.channels,
    faq: faq.length ? faq : fallback.faq,
    hours: {
      title: sanitizeString(String(hoursSrc.title || ''), 80) || fallback.hours.title,
      weekdays: sanitizeString(String(hoursSrc.weekdays || ''), 120) || fallback.hours.weekdays,
      weekend: sanitizeString(String(hoursSrc.weekend || ''), 120) || fallback.hours.weekend,
      timezone: sanitizeString(String(hoursSrc.timezone || ''), 80) || fallback.hours.timezone,
    },
  };
}

function sanitizeDocumentLayout(raw, slug) {
  const fallback = defaultDocumentLayout(slug);
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    eyebrow: sanitizeString(String(src.eyebrow ?? fallback.eyebrow ?? ''), 60),
    intro: sanitizeString(String(src.intro ?? fallback.intro ?? ''), 400),
    showToc: src.showToc !== undefined ? Boolean(src.showToc) : Boolean(fallback.showToc),
    updatedLabel: sanitizeString(String(src.updatedLabel ?? fallback.updatedLabel ?? ''), 120),
  };
}

function sanitizeLayoutData(layoutType, layoutData, slug) {
  if (layoutType === 'help') return sanitizeHelpLayout(layoutData, slug);
  if (layoutType === 'document') return sanitizeDocumentLayout(layoutData, slug);
  return layoutData && typeof layoutData === 'object' ? layoutData : null;
}

function getDefaultLayoutForSlug(slug) {
  const layoutType = resolveLayoutType(slug, null);
  if (!layoutType) return { layoutType: null, layoutData: null };
  return {
    layoutType,
    layoutData:
      layoutType === 'help' ? defaultHelpLayout(slug) : defaultDocumentLayout(slug),
  };
}

module.exports = {
  HELP_SLUGS,
  DOCUMENT_SLUGS,
  defaultHelpLayout,
  defaultDocumentLayout,
  resolveLayoutType,
  sanitizeLayoutData,
  sanitizeHelpLayout,
  sanitizeDocumentLayout,
  getDefaultLayoutForSlug,
};
