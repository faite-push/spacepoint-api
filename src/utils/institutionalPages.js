/** Páginas institucionais padrão + conteúdo inicial editável no admin. */

function paragraph(text) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

function heading(level, text) {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

function doc(...nodes) {
  return { type: 'doc', content: nodes };
}

const DEFAULT_INSTITUTIONAL_PAGES_RAW = [
  {
    slug: 'about',
    title: 'Quem somos',
    sortOrder: 0,
    metaTitle: 'Quem somos | Space Point',
    metaDescription: 'Conheça a Space Point — loja brasileira de jogos digitais para PlayStation.',
    content: doc(
      paragraph(
        'A Space Point BR LTDA é uma empresa brasileira especializada na venda de jogos digitais para consoles PlayStation, oferecendo uma experiência prática, segura e acessível para gamers de todo o país.'
      ),
      paragraph(
        'Nossa missão é entregar chaves e produtos digitais com agilidade, suporte humanizado e transparência em todo o processo de compra.'
      )
    ),
  },
  {
    slug: 'privacy',
    title: 'Política de Privacidade',
    sortOrder: 1,
    metaTitle: 'Política de Privacidade | Space Point',
    metaDescription: 'Saiba como coletamos, usamos e protegemos seus dados pessoais.',
    content: doc(
      paragraph(
        'Esta Política de Privacidade descreve como a Space Point coleta, utiliza, armazena e protege os dados pessoais dos usuários da loja, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).'
      ),
      heading(2, '1. Dados que coletamos'),
      paragraph(
        'Podemos coletar: nome, e-mail, telefone, documento (quando necessário para o pedido), endereço de IP, dados de navegação, histórico de compras e informações fornecidas no checkout ou no chat de suporte.'
      ),
      heading(2, '2. Finalidade do tratamento'),
      paragraph(
        'Utilizamos os dados para processar pedidos, entregar produtos digitais, prestar suporte, prevenir fraudes, cumprir obrigações legais e, com base no interesse legítimo ou consentimento, enviar comunicações de marketing (como recuperação de carrinho).'
      ),
      heading(2, '3. Compartilhamento'),
      paragraph(
        'Seus dados podem ser compartilhados com processadores de pagamento, provedores de e-mail/hospedagem e autoridades quando exigido por lei. Não vendemos seus dados pessoais.'
      ),
      heading(2, '4. Seus direitos'),
      paragraph(
        'Você pode solicitar acesso, correção, exclusão, portabilidade ou oposição ao tratamento dos seus dados, além de revogar consentimentos, pelos canais de atendimento da loja.'
      ),
      heading(2, '5. Contato'),
      paragraph(
        'Para dúvidas sobre privacidade, utilize o chat da loja ou o e-mail de contato informado no rodapé do site. Edite este texto no painel administrativo conforme a realidade jurídica da sua empresa.'
      )
    ),
  },
  {
    slug: 'refunds',
    title: 'Política de Trocas e Devoluções',
    sortOrder: 2,
    metaTitle: 'Trocas e Devoluções | Space Point',
    metaDescription: 'Regras de troca, reembolso e garantia para produtos digitais.',
    content: doc(
      paragraph(
        'Produtos digitais (códigos, chaves e contas) possuem regras específicas. Leia com atenção antes de finalizar a compra.'
      ),
      heading(2, '1. Natureza do produto'),
      paragraph(
        'Após a entrega do código ou do acesso digital, o produto é considerado consumido. Em regra, não há arrependimento com reembolso após a revelação/uso da chave, salvo nos casos previstos nesta política ou no Código de Defesa do Consumidor.'
      ),
      heading(2, '2. Quando o reembolso é possível'),
      paragraph(
        'Podemos analisar reembolso ou reposição quando: o código estiver inválido/já utilizado antes da entrega; houver falha comprovada na entrega; ou o produto não corresponder ao anunciado. Abra um chamado pelo chat do pedido o quanto antes.'
      ),
      heading(2, '3. Prazos'),
      paragraph(
        'Solicitações devem ser feitas preferencialmente em até 7 dias após a entrega, com evidências (prints, vídeos ou mensagens de erro). Cada caso é analisado individualmente.'
      ),
      heading(2, '4. Como solicitar'),
      paragraph(
        'Acesse o pedido na sua conta, abra o chat de suporte e descreva o problema. Não compartilhe códigos em canais públicos. Edite este texto no painel conforme a política comercial da sua loja.'
      )
    ),
  },
  {
    slug: 'terms',
    title: 'Termos e Condições',
    sortOrder: 3,
    metaTitle: 'Termos e Condições | Space Point',
    metaDescription: 'Termos de uso e condições de compra da loja Space Point.',
    content: doc(
      paragraph(
        'Ao utilizar este site e finalizar uma compra, você concorda com estes Termos e Condições. Se não concordar, não utilize a loja.'
      ),
      heading(2, '1. Objeto'),
      paragraph(
        'A Space Point comercializa produtos digitais (jogos, DLCs, assinaturas e correlatos) para consoles e plataformas indicadas em cada anúncio.'
      ),
      heading(2, '2. Conta e cadastro'),
      paragraph(
        'Você é responsável pela veracidade dos dados informados e pela segurança do acesso à sua conta. Pedidos feitos com dados incorretos podem atrasar ou impedir a entrega.'
      ),
      heading(2, '3. Preços e pagamento'),
      paragraph(
        'Os preços são os exibidos no checkout. O pedido só é confirmado após a aprovação do pagamento pelo meio escolhido (PIX, cartão ou outro disponível).'
      ),
      heading(2, '4. Entrega digital'),
      paragraph(
        'A entrega ocorre de forma digital (código, instruções ou arquivo) após a confirmação do pagamento, sujeita à disponibilidade de estoque. Prazos estimados podem variar conforme o produto.'
      ),
      heading(2, '5. Condutas proibidas'),
      paragraph(
        'É proibido uso fraudulento de meios de pagamento, chargeback indevido, revenda não autorizada quando vedada pelo fabricante, ou qualquer prática ilícita relacionada aos produtos adquiridos.'
      ),
      heading(2, '6. Alterações'),
      paragraph(
        'Estes termos podem ser atualizados a qualquer momento. A versão vigente é a publicada nesta página. Edite o conteúdo no painel administrativo com o apoio jurídico adequado.'
      )
    ),
  },
  {
    slug: 'support',
    title: 'Central de Ajuda',
    sortOrder: 4,
    metaTitle: 'Central de Ajuda | Space Point',
    metaDescription: 'Como comprar, receber e obter suporte na Space Point.',
    content: doc(
      paragraph(
        'Encontre respostas rápidas sobre compra, entrega digital e atendimento. Se precisar de ajuda personalizada, use o chat da loja ou o chat do seu pedido.'
      ),
      heading(2, 'Como comprar'),
      paragraph(
        '1) Escolha o produto e a variação desejada. 2) Adicione ao carrinho e vá ao checkout. 3) Preencha seus dados e escolha o pagamento. 4) Após a confirmação, acompanhe o pedido na sua conta.'
      ),
      heading(2, 'Como funciona a entrega'),
      paragraph(
        'Produtos digitais são entregues automaticamente ou com assistência do suporte após o pagamento aprovado. As instruções e códigos ficam disponíveis no pedido / chat.'
      ),
      heading(2, 'Problemas com o código'),
      paragraph(
        'Se o código não funcionar, não tente usá-lo em várias contas. Abra o chat do pedido, envie um print do erro e aguarde nosso atendimento.'
      ),
      heading(2, 'Fale conosco'),
      paragraph(
        'Utilize o chat online da loja (ícone de atendimento) ou o chat vinculado ao pedido. Horários e canais adicionais podem ser informados nesta página — edite no painel admin.'
      )
    ),
  },
  {
    slug: 'cookies',
    title: 'Política de Cookies',
    sortOrder: 5,
    metaTitle: 'Política de Cookies | Space Point',
    metaDescription: 'Como utilizamos cookies e tecnologias similares neste site.',
    content: doc(
      paragraph(
        'Utilizamos cookies e tecnologias semelhantes para o funcionamento da loja, segurança, métricas e, quando aplicável, marketing.'
      ),
      heading(2, 'O que são cookies'),
      paragraph(
        'São pequenos arquivos armazenados no seu dispositivo que permitem lembrar preferências, manter a sessão e entender como o site é usado.'
      ),
      heading(2, 'Tipos que podemos usar'),
      paragraph(
        'Essenciais (login, carrinho, segurança); de desempenho/analytics (ex.: Google Analytics); e de marketing (ex.: Meta Pixel, Google Ads), conforme os plugins ativados na loja.'
      ),
      heading(2, 'Como gerenciar'),
      paragraph(
        'Você pode bloquear ou apagar cookies nas configurações do navegador. Isso pode afetar funções da loja, como manter itens no carrinho.'
      ),
      heading(2, 'Mais informações'),
      paragraph(
        'Consulte também a Política de Privacidade. Edite este texto no painel administrativo para refletir as ferramentas realmente utilizadas pela loja.'
      )
    ),
  },
  {
    slug: 'fale-conosco',
    title: 'Fale Conosco',
    sortOrder: 6,
    metaTitle: 'Fale Conosco | Space Point',
    metaDescription: 'Entre em contato com a equipe Space Point.',
    content: doc(
      paragraph(
        'Precisa de ajuda com um pedido, dúvida sobre um produto ou informações comerciais? Nossa equipe está pronta para atender você.'
      ),
      heading(2, 'Canais de atendimento'),
      paragraph(
        'O jeito mais rápido é pelo chat online da loja (ícone de atendimento) ou pelo chat vinculado ao seu pedido na área Minha Conta.'
      ),
      heading(2, 'Antes de abrir um chamado'),
      paragraph(
        'Tenha em mãos o número do pedido, o e-mail usado na compra e prints ou vídeos do problema (quando houver erro de código ou ativação). Isso agiliza a análise.'
      ),
      heading(2, 'Horário e resposta'),
      paragraph(
        'Respondemos o mais rápido possível dentro do horário comercial da loja. Edite esta página no painel administrativo para informar horários e canais oficiais (e-mail, WhatsApp, Discord, etc.).'
      )
    ),
  },
  {
    slug: 'como-comprar',
    title: 'Como comprar',
    sortOrder: 7,
    metaTitle: 'Como comprar | Space Point',
    metaDescription: 'Passo a passo para comprar jogos digitais na Space Point.',
    content: doc(
      paragraph(
        'Comprar na Space Point é simples e 100% digital. Siga o passo a passo abaixo.'
      ),
      heading(2, '1. Escolha o produto'),
      paragraph(
        'Navegue pelas categorias ou use a busca. Confira a plataforma (ex.: PlayStation), a região/conta exigida e a descrição do anúncio antes de adicionar ao carrinho.'
      ),
      heading(2, '2. Finalize no checkout'),
      paragraph(
        'Informe seus dados, escolha o método de pagamento disponível (PIX, cartão ou outro) e confirme o pedido. O valor cobrado é o exibido no checkout.'
      ),
      heading(2, '3. Acompanhe a entrega'),
      paragraph(
        'Após a aprovação do pagamento, o código ou as instruções ficam disponíveis no pedido na sua conta. Em alguns casos, o suporte envia orientação pelo chat do pedido.'
      ),
      heading(2, 'Dica'),
      paragraph(
        'Mantenha o e-mail cadastrado atualizado — usamos esse canal para avisos do pedido e recuperação de carrinho, quando aplicável.'
      )
    ),
  },
  {
    slug: 'como-funciona',
    title: 'Como funciona',
    sortOrder: 8,
    metaTitle: 'Como funciona | Space Point',
    metaDescription: 'Entenda como funciona a compra e a entrega digital na Space Point.',
    content: doc(
      paragraph(
        'A Space Point vende produtos digitais: após o pagamento, você recebe um código, chave ou instruções para ativar no console/plataforma indicada.'
      ),
      heading(2, 'Pagamento aprovado'),
      paragraph(
        'O pedido só é processado depois da confirmação do pagamento pelo gateway. Enquanto estiver pendente, acompanhe o status na área Meus Pedidos.'
      ),
      heading(2, 'Entrega digital'),
      paragraph(
        'A entrega é automática ou assistida, conforme o produto e o estoque. Códigos e instruções aparecem no detalhe do pedido e/ou no chat do pedido.'
      ),
      heading(2, 'Ativação'),
      paragraph(
        'Siga as instruções do produto (conta, região, loja da plataforma). Em caso de dúvida, use o chat do pedido antes de tentar ativar em várias contas.'
      ),
      heading(2, 'Suporte'),
      paragraph(
        'Se algo der errado (código inválido, erro de região, etc.), abra o chat do pedido com evidências. Consulte também a Política de Trocas e Devoluções.'
      )
    ),
  },
  {
    slug: 'envio-expresso',
    title: 'Envio Expresso',
    sortOrder: 9,
    metaTitle: 'Envio Expresso | Space Point',
    metaDescription: 'Entrega digital rápida após a confirmação do pagamento.',
    content: doc(
      paragraph(
        'Na Space Point, “envio” significa entrega digital: você recebe o produto online, sem frete físico.'
      ),
      heading(2, 'O que é Envio Expresso'),
      paragraph(
        'É o nosso fluxo de entrega prioritária para produtos digitais com estoque disponível: assim que o pagamento é confirmado, o código ou as instruções são liberados o mais rápido possível.'
      ),
      heading(2, 'Quando ocorre'),
      paragraph(
        'Depende da disponibilidade do item e da aprovação do pagamento. Pedidos em análise antifraude ou com pagamento pendente podem levar mais tempo.'
      ),
      heading(2, 'Onde encontrar o produto'),
      paragraph(
        'Acesse Minha Conta → Meus Pedidos → abra o pedido. O conteúdo entregue (código, arquivo ou instruções) fica registrado ali e, quando necessário, no chat do pedido.'
      ),
      heading(2, 'Atrasos'),
      paragraph(
        'Se o prazo estimado passar, fale conosco pelo chat do pedido. Edite esta página no admin para informar SLAs e condições específicas da sua operação.'
      )
    ),
  },
];

const {
  getDefaultLayoutForSlug,
} = require('./institutionalLayout');

const DEFAULT_INSTITUTIONAL_PAGES = DEFAULT_INSTITUTIONAL_PAGES_RAW.map((page) => {
  const { layoutType, layoutData } = getDefaultLayoutForSlug(page.slug);
  return {
    ...page,
    layoutType,
    layoutData,
  };
});

const INSTITUTIONAL_SLUGS = DEFAULT_INSTITUTIONAL_PAGES.map((p) => p.slug);

module.exports = {
  DEFAULT_INSTITUTIONAL_PAGES,
  INSTITUTIONAL_SLUGS,
};
