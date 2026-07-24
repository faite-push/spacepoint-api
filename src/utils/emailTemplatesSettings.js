const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

const DEFAULT_HEADER_HTML = `<!-- Cabeçalho global (padrão Space Point) -->
<div style="background:#A855F7;padding:24px 24px 12px;text-align:center;border-bottom:1px solid #e9d5ff;">
  <a href="{{storeUrl}}" style="text-decoration:none;">
    <img src="{{logoUrl}}" width="140" alt="{{storeName}}" style="display:inline-block;border:0;outline:none;text-decoration:none;" />
  </a>
</div>`;

const DEFAULT_FOOTER_HTML = `<!-- Rodapé global (padrão Space Point) -->
<div style="padding:8px 0 24px;text-align:center;">
  <a href="{{storeUrl}}" style="text-decoration:none;">
    <img src="{{logoUrl}}" width="140" alt="{{storeName}}" style="display:block;margin:0 auto;border:0;outline:none;" />
  </a>
</div>`;

const SAMPLE_BODY_HTML = `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#f3e8ff;color:#7c3aed;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Pré-visualização</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Pré-visualização do e-mail</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Assim o conteúdo principal aparece entre o cabeçalho e o rodapé</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Este é o conteúdo principal do e-mail. Edite o bloco para personalizar a mensagem enviada aos clientes.</p>
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Clique no botão abaixo para continuar.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">{{ctaLabel}}</a>
</div>`;

const DEFAULT_SUBJECTS = {
  orderCreated: '{{storeName}}: pedido #{{orderId}} aguardando pagamento',
  paymentPending: 'Finalize agora — pedido #{{orderId}} ainda está pendente',
  paymentConfirmed: 'Pagamento confirmado — pedido #{{orderId}} em processamento',
  orderDelivered: 'Seu pedido #{{orderId}} foi entregue',
  orderCancelled: 'Pedido #{{orderId}} cancelado — você pode refazer em 1 clique',
  orderRefunded: 'Reembolso confirmado — pedido #{{orderId}}',
  reviewInvite: '{{customerName}}, como foi sua compra #{{orderId}}?',
  abandonedCartRecovery: '{{customerName}}, seu carrinho ainda está reservado',
  abandonedCartRecovery_step2: '{{customerName}}, ainda dá tempo — finalize seu carrinho',
  abandonedCartRecovery_step3: 'Última chance: seus itens podem sair do carrinho',
  abandonedProductRecovery: 'O produto que você viu ainda está disponível',
  abandonedProductRecovery_step2: 'O produto que você viu continua em estoque',
  abandonedProductRecovery_step3: 'Último aviso: garanta o produto antes que acabe',
  cancelledOrderRecovery: '{{customerName}}, seus itens ainda podem ser seus — refaça o pedido #{{orderId}}',
  cancelledOrderRecovery_step2: 'Seu pedido #{{orderId}} ainda pode ser refeito em 1 clique',
  cancelledOrderRecovery_step3: 'Última chance de recuperar o pedido #{{orderId}}',
};

const DEFAULT_PREHEADERS = {
  orderCreated: 'Pague em poucos cliques e garanta seus produtos antes que o prazo expire.',
  paymentPending: 'Seu pedido está reservado. Conclua o pagamento para não perder os itens.',
  paymentConfirmed: 'Recebemos seu pagamento. Acompanhe a entrega na sua conta.',
  orderDelivered: 'Acesse os detalhes da entrega e as instruções de uso no chat do pedido.',
  orderCancelled: 'Se ainda quiser os produtos, é só refazer o pedido na loja.',
  orderRefunded: 'O valor será creditado conforme o prazo do seu meio de pagamento.',
  reviewInvite: 'Sua opinião leva menos de 1 minuto e ajuda outros clientes.',
  abandonedCartRecovery: 'Seus itens ainda estão no carrinho. Finalize agora e garanta o seu.',
  abandonedCartRecovery_step2: 'Não deixe sua compra pela metade — o checkout está a um clique.',
  abandonedCartRecovery_step3: 'Depois disso, o carrinho pode ser liberado. Finalize agora.',
  abandonedProductRecovery: 'Garanta o produto antes que o estoque acabe.',
  abandonedProductRecovery_step2: 'Outros clientes também estão olhando este item.',
  abandonedProductRecovery_step3: 'Estoque limitado. Abra o produto e finalize a compra.',
  cancelledOrderRecovery: 'Ainda dá tempo de garantir os produtos do pedido cancelado.',
  cancelledOrderRecovery_step2: 'Montamos o carrinho de novo para você. É só pagar.',
  cancelledOrderRecovery_step3: 'Último lembrete para recuperar os itens do pedido cancelado.',
};

const DEFAULT_BODIES = {
  orderCreated: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fef3c7;color:#b45309;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Aguardando pagamento</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Pedido recebido</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Falta só confirmar o pagamento</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Recebemos seu pedido <strong>#{{orderId}}</strong>. Ele está reservado e aguardando pagamento para ser confirmado.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;color:#27272a;">Total: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
{{#if paymentExpiresLabel}}
<p style="color:#b45309;font-size:13px;">⏱ O pagamento expira em <strong>{{paymentExpiresLabel}}</strong>.</p>
{{/if}}
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Finalize o pagamento agora para confirmarmos seu pedido e liberarmos a entrega.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Garantir meu pedido</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  paymentPending: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fef3c7;color:#b45309;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Pagamento pendente</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Seu pedido ainda está aberto</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Conclua em poucos minutos</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">O pedido <strong>#{{orderId}}</strong> continua aguardando pagamento. Finalize agora para não perder seus itens.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
{{#if copyPaste}}
<div style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:16px;margin:16px 0;word-break:break-all;font-family:monospace;font-size:12px;color:#18181b;">{{copyPaste}}</div>
{{/if}}
{{#if paymentExpiresLabel}}
<p style="color:#b45309;font-size:13px;">⏱ Expira em <strong>{{paymentExpiresLabel}}</strong>.</p>
{{/if}}
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Abra a página de pagamento e conclua com PIX ou cartão.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">{{ctaLabel}}</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  paymentConfirmed: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Pagamento aprovado</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Tudo certo com seu pagamento</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Já estamos preparando seu pedido</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Confirmamos o pagamento do pedido <strong>#{{orderId}}</strong>. Agora é só acompanhar a entrega.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#15803d;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Acompanhe o status e fale com o suporte pelo chat do pedido na sua conta.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Ver meu pedido</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  orderDelivered: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Entregue</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Pedido entregue</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Aproveite sua compra</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Seu pedido <strong>#{{orderId}}</strong> foi entregue com sucesso. Os detalhes e instruções estão no chat do pedido.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#15803d;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Abra o pedido para ver a entrega e, se quiser, deixe sua avaliação.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">{{ctaLabel}}</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  orderCancelled: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Pedido cancelado</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Seu pedido foi cancelado</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">{{subtitle}}</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">O pedido <strong>#{{orderId}}</strong> não foi concluído.</p>
{{#if reason}}
<p style="color:#71717a;">Motivo: {{reason}}</p>
{{/if}}
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Se ainda quiser os produtos, você pode refazer o pedido na loja em poucos cliques.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Refazer pedido</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  reviewInvite: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#f3e8ff;color:#7c3aed;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Sua opinião</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Como foi sua compra?</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Leva menos de 1 minuto</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Seu pedido <strong>#{{orderId}}</strong> já foi entregue. Sua avaliação ajuda outros clientes e melhora nosso atendimento.</p>
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Clique no botão e conte como foi sua experiência.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Deixar avaliação</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  cancelledOrderRecovery: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Pedido cancelado</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Ainda quer esses produtos?</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Refaça o pedido em poucos cliques</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">O pedido <strong>#{{orderId}}</strong> foi cancelado, mas os itens ainda estão disponíveis na loja.</p>
{{#if reason}}
<p style="color:#71717a;">Motivo: {{reason}}</p>
{{/if}}
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;color:#27272a;">Total anterior: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Clique no botão: montamos o carrinho com os mesmos itens e você só finaliza o pagamento.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Refazer meu pedido</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  abandonedCartRecovery: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fef3c7;color:#b45309;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Carrinho reservado</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Seu carrinho ainda está te esperando</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Os itens podem sair do estoque</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Você deixou produtos no carrinho. Finalize agora e garanta sua compra antes que o estoque acabe.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;color:#27272a;">Subtotal: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
{{#if couponCode}}
<p style="color:#15803d;font-size:13px;">Cupom salvo no carrinho: <strong>{{couponCode}}</strong></p>
{{/if}}
<p style="margin:16px 0;padding:12px 14px;background:#f4f4f5;border-radius:8px;font-size:13px;color:#52525b;text-align:center;">
  🔥 Outros clientes também estão olhando esses produtos agora.
</p>
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Volte ao checkout e finalize em poucos cliques. Seus itens ainda estão no carrinho.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Garantir meu pedido</a>
</div>
<p style="text-align:center;">
  <a href="{{ctaUrl}}" style="color:#A855F7;text-decoration:none;font-weight:500;">Ver meu carrinho completo</a>
</p>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  abandonedCartRecovery_step2: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#ffedd5;color:#c2410c;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Lembrete 2</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Ainda dá tempo de finalizar</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Seus itens continuam no carrinho</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Passou um tempo e seu carrinho ainda está aberto. Finalize agora para não perder os produtos.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;color:#27272a;">Subtotal: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
{{#if couponCode}}
<p style="color:#15803d;font-size:13px;">Cupom salvo: <strong>{{couponCode}}</strong></p>
{{/if}}
<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#c2410c;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Abra o checkout e conclua o pagamento em poucos cliques.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Finalizar compra agora</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  abandonedCartRecovery_step3: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Última chance</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Última chance do seu carrinho</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Depois disso, os itens podem ser liberados</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Este é o último lembrete. Seus produtos ainda estão no carrinho — finalize agora para garantir.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;color:#27272a;">Subtotal: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#b91c1c;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Clique abaixo e conclua o pagamento antes que o carrinho expire.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Garantir agora</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  abandonedProductRecovery: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fef3c7;color:#b45309;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Ainda disponível</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Esse produto ainda está disponível</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Garanta o seu antes que acabe</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Você demonstrou interesse em um produto que ainda está em estoque. Finalize agora e garanta o seu.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#7c3aed;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Abra a página do produto e conclua a compra enquanto ainda há unidades.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Garantir agora</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  abandonedProductRecovery_step2: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#ffedd5;color:#c2410c;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Lembrete 2</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">O produto continua em estoque</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Outros clientes também estão olhando</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">O item que você viu ainda está disponível. Garanta o seu antes que o estoque baixe.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#c2410c;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Abra o produto e finalize a compra enquanto há unidades.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Ver produto agora</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  abandonedProductRecovery_step3: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Último aviso</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Último aviso de estoque</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Garanta agora antes que acabe</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Este é o último lembrete sobre o produto que você viu. O estoque pode acabar a qualquer momento.</p>
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#b91c1c;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Abra a página do produto e conclua a compra agora.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Garantir antes que acabe</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  cancelledOrderRecovery_step2: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#ffedd5;color:#c2410c;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Lembrete 2</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Seu pedido ainda pode ser refeito</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">Montamos o carrinho para você</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">O pedido <strong>#{{orderId}}</strong> foi cancelado, mas ainda dá para recuperar os itens em 1 clique.</p>
{{#if reason}}
<p style="color:#71717a;">Motivo: {{reason}}</p>
{{/if}}
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;color:#27272a;">Total anterior: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#c2410c;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Clique no botão: remontamos o carrinho e você só finaliza o pagamento.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Refazer pedido agora</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,

  cancelledOrderRecovery_step3: `<div style="text-align:center;margin-bottom:16px;">
  <span style="display:inline-block;background:#fee2e2;color:#b91c1c;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;">Última chance</span>
  <h1 style="margin:14px 0 0;font-size:24px;color:#18181b;">Última chance de recuperar o pedido</h1>
  <p style="margin:8px 0 0;color:#7c3aed;font-size:15px;">É só um clique para remontar</p>
  <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
</div>
<p style="margin:-14px 0 16px;font-size:16px;color:#27272a;">Olá, <strong>{{customerName}}</strong>!</p>
<p style="max-width:520px;color:#52525b;">Último lembrete sobre o pedido <strong>#{{orderId}}</strong>. Os itens ainda podem ser seus.</p>
{{#if reason}}
<p style="color:#71717a;">Motivo: {{reason}}</p>
{{/if}}
{{#if itemsHtml}}
<div style="border:1px solid #e4e4e7;border-radius:10px;padding:10px;margin:24px 0;background:#fafafa;">{{itemsHtml}}</div>
{{/if}}
{{#if totalLabel}}
<p style="font-size:16px;margin:8px 0;color:#27272a;">Total anterior: <strong style="color:#A855F7;">{{totalLabel}}</strong></p>
{{/if}}
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0;font-size:13px;font-weight:700;color:#b91c1c;">Próximo passo</p>
  <p style="margin:6px 0 0;font-size:14px;color:#52525b;">Refaça o pedido agora — depois deste e-mail, o lembrete automático encerra.</p>
</div>
<div style="text-align:center;margin:22px 0;">
  <a href="{{ctaUrl}}" style="display:inline-block;background:#A855F7;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 40px;border-radius:10px;font-size:17px;">Recuperar meu pedido</a>
</div>
<p style="margin-top:12px;text-align:center;color:#71717a;">Qualquer dúvida, responda este e-mail ou fale conosco pelo chat.</p>`,
};


/** Catálogo de blocos editáveis por aba */
const EMAIL_BLOCK_CATALOG = {
  components: [
    {
      id: 'header',
      key: 'headerHtml',
      title: 'Cabeçalho do e-mail',
      description: 'Faixa roxa com logo no topo de todos os e-mails.',
      kind: 'component',
    },
    {
      id: 'footer',
      key: 'footerHtml',
      title: 'Rodapé do e-mail',
      description: 'Logo da loja no fechamento do e-mail.',
      kind: 'component',
    },
  ],
  transactional: [
    {
      id: 'orderCreated',
      key: 'bodies.orderCreated',
      title: 'Pedido recebido',
      description: 'Enviado quando o cliente finaliza a compra e o pedido fica aguardando pagamento.',
      kind: 'body',
      defaultTitle: 'Pedido recebido',
      defaultSubtitle: 'Aguardando pagamento',
    },
    {
      id: 'paymentPending',
      key: 'bodies.paymentPending',
      title: 'Pagamento pendente',
      description: 'Lembrete com link/PIX para concluir o pagamento.',
      kind: 'body',
      defaultTitle: 'Pagamento pendente',
      defaultSubtitle: 'Finalize sua compra',
    },
    {
      id: 'paymentConfirmed',
      key: 'bodies.paymentConfirmed',
      title: 'Pagamento aprovado',
      description: 'Confirmação de pagamento e próximos passos da entrega.',
      kind: 'body',
      defaultTitle: 'Pagamento aprovado',
      defaultSubtitle: 'Obrigado pela compra!',
    },
    {
      id: 'orderDelivered',
      key: 'bodies.orderDelivered',
      title: 'Pedido entregue',
      description: 'Aviso de entrega com CTA para abrir o pedido ou avaliar.',
      kind: 'body',
      defaultTitle: 'Pedido entregue',
      defaultSubtitle: 'Aproveite sua compra!',
    },
    {
      id: 'orderCancelled',
      key: 'bodies.orderCancelled',
      title: 'Pedido cancelado',
      description: 'Notificação de cancelamento ou expiração de pagamento.',
      kind: 'body',
      defaultTitle: 'Pedido cancelado',
      defaultSubtitle: 'Pedido não concluído',
    },
    {
      id: 'reviewInvite',
      key: 'bodies.reviewInvite',
      title: 'Convite de avaliação',
      description: 'Pede feedback após a entrega do pedido.',
      kind: 'body',
      defaultTitle: 'Avalie sua compra',
      defaultSubtitle: 'Sua opinião é importante',
    },
  ],
  abandonedCart: [
    {
      id: 'abandonedCartRecovery',
      key: 'bodies.abandonedCartRecovery',
      title: 'Carrinho — etapa 1',
      description: 'Primeiro e-mail da régua de carrinho abandonado.',
      kind: 'body',
      defaultTitle: 'Seu carrinho está te esperando!',
      defaultSubtitle: 'Não deixe sua compra escapar',
    },
    {
      id: 'abandonedCartRecovery_step2',
      key: 'bodies.abandonedCartRecovery_step2',
      title: 'Carrinho — etapa 2',
      description: 'Segundo lembrete da régua (mais urgente).',
      kind: 'body',
      defaultTitle: 'Ainda dá tempo de finalizar',
      defaultSubtitle: 'Seus itens continuam reservados',
    },
    {
      id: 'abandonedCartRecovery_step3',
      key: 'bodies.abandonedCartRecovery_step3',
      title: 'Carrinho — etapa 3',
      description: 'Último e-mail da régua de carrinho.',
      kind: 'body',
      defaultTitle: 'Última chance do seu carrinho',
      defaultSubtitle: 'Finalize antes que os itens saiam',
    },
  ],
  abandonedProduct: [
    {
      id: 'abandonedProductRecovery',
      key: 'bodies.abandonedProductRecovery',
      title: 'Produto — etapa 1',
      description: 'Primeiro e-mail após visualizar um produto sem montar carrinho.',
      kind: 'body',
      defaultTitle: 'Esse produto ainda está disponível',
      defaultSubtitle: 'Garanta o seu antes que acabe',
    },
    {
      id: 'abandonedProductRecovery_step2',
      key: 'bodies.abandonedProductRecovery_step2',
      title: 'Produto — etapa 2',
      description: 'Segundo lembrete de produto abandonado.',
      kind: 'body',
      defaultTitle: 'O produto continua em estoque',
      defaultSubtitle: 'Outros clientes também estão olhando',
    },
    {
      id: 'abandonedProductRecovery_step3',
      key: 'bodies.abandonedProductRecovery_step3',
      title: 'Produto — etapa 3',
      description: 'Último aviso de estoque da régua de produto.',
      kind: 'body',
      defaultTitle: 'Último aviso de estoque',
      defaultSubtitle: 'Garanta agora antes que acabe',
    },
  ],
  cancelledOrder: [
    {
      id: 'cancelledOrderRecovery',
      key: 'bodies.cancelledOrderRecovery',
      title: 'Cancelado — etapa 1',
      description: 'Primeiro e-mail após cancelamento ou expiração de pagamento.',
      kind: 'body',
      defaultTitle: 'Ainda quer esses produtos?',
      defaultSubtitle: 'Refaça o pedido em poucos cliques',
    },
    {
      id: 'cancelledOrderRecovery_step2',
      key: 'bodies.cancelledOrderRecovery_step2',
      title: 'Cancelado — etapa 2',
      description: 'Segundo lembrete para refazer o pedido cancelado.',
      kind: 'body',
      defaultTitle: 'Seu pedido ainda pode ser refeito',
      defaultSubtitle: 'Montamos o carrinho para você',
    },
    {
      id: 'cancelledOrderRecovery_step3',
      key: 'bodies.cancelledOrderRecovery_step3',
      title: 'Cancelado — etapa 3',
      description: 'Último e-mail da régua de pedido cancelado.',
      kind: 'body',
      defaultTitle: 'Última chance de recuperar o pedido',
      defaultSubtitle: 'É só um clique para remontar',
    },
  ],
};

/** Detecta templates antigos (tema escuro / legado) para forçar o padrão claro. */
function isLegacyDarkHtml(html) {
  const s = String(html || '');
  return (
    /background:\s*#0a0a0a|background:\s*#050505|background:\s*#141417|#06b6d4|#f3e8ff|#ffffff13|color:\s*#d4d4d8|logoWhiteUrl|<thead>|<tfoot>|Este é um e-mail automático|<\/div>\s*<\/div>\s*<p/i.test(
      s
    ) || /<h1[^>]*style="[^"]*color:\s*#ffffff/i.test(s)
  );
}

/** Corpos claros antigos (sem bloco "Próximo passo") — atualiza para o padrão novo. */
function isOutdatedLightBody(html) {
  const s = String(html || '');
  return (
    /Qualquer dúvida é só chamar nosso suporte/i.test(s) && !/Próximo passo/i.test(s)
  );
}

function normalizeEmailTemplates(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const bodiesSrc = src.bodies && typeof src.bodies === 'object' ? src.bodies : {};
  const bodies = {};
  for (const key of Object.keys(DEFAULT_BODIES)) {
    const saved = typeof bodiesSrc[key] === 'string' ? bodiesSrc[key].trim() : '';
    bodies[key] =
      saved && !isLegacyDarkHtml(saved) && !isOutdatedLightBody(saved)
        ? saved
        : DEFAULT_BODIES[key];
  }

  const subjectsSrc = src.subjects && typeof src.subjects === 'object' ? src.subjects : {};
  const subjects = {};
  for (const key of Object.keys(DEFAULT_SUBJECTS)) {
    const saved = typeof subjectsSrc[key] === 'string' ? subjectsSrc[key].trim() : '';
    subjects[key] = saved || DEFAULT_SUBJECTS[key];
  }

  const preheadersSrc = src.preheaders && typeof src.preheaders === 'object' ? src.preheaders : {};
  const preheaders = {};
  for (const key of Object.keys(DEFAULT_PREHEADERS)) {
    const saved = typeof preheadersSrc[key] === 'string' ? preheadersSrc[key].trim() : '';
    preheaders[key] = saved || DEFAULT_PREHEADERS[key];
  }

  const headerHtml =
    typeof src.headerHtml === 'string' && src.headerHtml.trim() && !isLegacyDarkHtml(src.headerHtml)
      ? src.headerHtml
      : DEFAULT_HEADER_HTML;
  const footerHtml =
    typeof src.footerHtml === 'string' && src.footerHtml.trim() && !isLegacyDarkHtml(src.footerHtml)
      ? src.footerHtml
      : DEFAULT_FOOTER_HTML;

  return {
    headerHtml,
    footerHtml,
    subjects,
    preheaders,
    bodies,
  };
}

function stripStatusBadges(html) {
  return String(html || '').replace(
    /\s*<span style="display:inline-block;background:[^"]*border-radius:999px;">[^<]*<\/span>\s*/gi,
    ''
  );
}

function applyEmailTemplate(html, vars = {}) {
  let out = stripStatusBadges(String(html || ''));

  out = out.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, inner) => {
    const value = vars[key];
    if (value === undefined || value === null || value === '' || value === false) return '';
    return inner;
  });

  out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (vars[key] === undefined || vars[key] === null) return '';
    return String(vars[key]);
  });

  return out;
}

function buildEmailDocument({ headerHtml, footerHtml, bodyHtml, vars }) {
  const header = applyEmailTemplate(headerHtml, vars);
  const footer = applyEmailTemplate(footerHtml, vars);
  const body = applyEmailTemplate(bodyHtml, vars);
  const preheaderRaw = vars?.preheader ? String(vars.preheader) : '';
  const preheader = preheaderRaw
    ? applyEmailTemplate(preheaderRaw, vars)
    : '';
  const preheaderBlock = preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
        ${preheader}
      </div>`
    : '';
  const unsubscribe = vars?.unsubscribeUrl
    ? ` <a href="${String(vars.unsubscribeUrl)}" style="color:#71717a;text-decoration:none;">Não quero mais receber estes lembretes</a>.`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;font-family:Inter,Arial,sans-serif;background:#f4f4f5;">
  ${preheaderBlock}
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden;color:#27272a;">
    ${header}
    <div style="padding:8px 24px 4px;color:#52525b;font-size:14px;line-height:1.6;">
      ${body}
      ${footer}
    </div>
  </div>
  <p style="max-width:520px;margin:16px auto 0;color:#a1a1aa;font-size:11px;text-align:center;font-family:Inter,Arial,sans-serif;">
    Este é um e-mail automático.${unsubscribe}
  </p>
</body>
</html>`;
}

async function getEmailTemplates(prisma) {
  const config = await prisma.siteConfig.findUnique({
    where: { id: 'default' },
    select: {
      emailTemplates: true,
      storeName: true,
      logoUrl: true,
      contactEmail: true,
      contactPhone: true,
    },
  });

  const storeUrl = FRONTEND_URL;
  const logoUrl = config?.logoUrl || `${storeUrl}/logo.png`;
  const logoWhiteUrl = `${storeUrl}/logo-white.png`;

  return {
    templates: normalizeEmailTemplates(config?.emailTemplates),
    branding: {
      storeName: config?.storeName?.trim() || 'Space Point',
      logoUrl,
      logoWhiteUrl,
      storeUrl,
      contactEmail: config?.contactEmail || '',
      contactPhone: config?.contactPhone || '',
      year: String(new Date().getFullYear()),
      customerName: 'Cliente',
      ctaUrl: storeUrl,
      ctaLabel: 'Abrir loja',
      unsubscribeUrl: '#',
    },
  };
}

module.exports = {
  DEFAULT_HEADER_HTML,
  DEFAULT_FOOTER_HTML,
  SAMPLE_BODY_HTML,
  EMAIL_BLOCK_CATALOG,
  DEFAULT_BODIES,
  DEFAULT_SUBJECTS,
  DEFAULT_PREHEADERS,
  normalizeEmailTemplates,
  applyEmailTemplate,
  buildEmailDocument,
  getEmailTemplates,
  FRONTEND_URL,
};
