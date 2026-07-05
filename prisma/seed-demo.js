const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Gerando dados fictícios de vendas...');

  // 1. Criar usuários fictícios
  const fakeUsers = [
    { name: 'João Silva', email: 'joao@demo.com' },
    { name: 'Maria Oliveira', email: 'maria@demo.com' },
    { name: 'Carlos Santos', email: 'carlos@demo.com' },
    { name: 'Ana Souza', email: 'ana@demo.com' },
    { name: 'Pedro Lima', email: 'pedro@demo.com' },
    { name: 'Julia Costa', email: 'julia@demo.com' },
    { name: 'Roberto Almeida', email: 'roberto@demo.com' },
    { name: 'Fernanda Rocha', email: 'fernanda@demo.com' },
    { name: 'Ricardo Mendes', email: 'ricardo@demo.com' },
    { name: 'Beatriz Lopes', email: 'beatriz@demo.com' },
  ];

  const users = [];
  for (const u of fakeUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { 
        id: crypto.randomUUID(),
        name: u.name,
        email: u.email,
        provider: 'local',
        isAdmin: false
      }
    });
    users.push(user);
  }

  // Pegar produtos existentes
  const products = await prisma.product.findMany();
  if (products.length === 0) {
    console.log('⚠️ Nenhum produto encontrado. Por favor, crie alguns produtos no painel primeiro.');
    return;
  }

  // 2. Gerar Pedidos e Pagamentos nos últimos 60 dias
  const statuses = ['PAID', 'PAID', 'PAID', 'PAID', 'PENDING', 'CANCELLED', 'DELIVERED'];
  const providers = ['PIX', 'MP', 'STRIPE', 'EFI'];

  // Limpar dados anteriores de teste se necessário (opcional)
  // await prisma.payment.deleteMany({ where: { user: { email: { endsWith: '@demo.com' } } } });
  // await prisma.order.deleteMany({ where: { user: { email: { endsWith: '@demo.com' } } } });

  console.log('🛒 Criando pedidos e pagamentos...');

  for (let i = 0; i < 180; i++) {
    const user = users[Math.floor(Math.random() * users.length)];
    const product = products[Math.floor(Math.random() * products.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const provider = providers[Math.floor(Math.random() * providers.length)];
    
    // Data aleatória nos últimos 60 dias com distribuição realista
    const date = new Date();
    const daysAgo = Math.floor(Math.random() * 60);
    date.setDate(date.getDate() - daysAgo);
    // Adicionar horas aleatorias para não ficar tudo meia-noite
    date.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
    
    const quantity = Math.floor(Math.random() * 2) + 1;
    const unitPrice = Math.floor(Number(product.price) * 100); // centavos
    const total = unitPrice * quantity;

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        status: status,
        total: total,
        createdAt: date,
        updatedAt: date,
        items: {
          create: {
            productId: product.id,
            quantity: quantity,
            unitPrice: unitPrice,
          }
        }
      }
    });

    if (status === 'PAID' || status === 'DELIVERED') {
      await prisma.payment.create({
        data: {
          userId: user.id,
          orderId: order.id,
          amount: total,
          status: 'PAID',
          provider: provider,
          externalId: `demo_${Math.random().toString(36).substr(2, 9)}`,
          description: `Pagamento do pedido #${order.id.slice(-6).toUpperCase()}`,
          createdAt: date,
          updatedAt: date,
        }
      });
    }
  }

  console.log(`✅ Sucesso! 180 pedidos e usuários demo criados.`);
  console.log(`📊 Prontos para testar o Dashboard com dados reais.`);
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
