# SpacePoint API 🛰️

A **SpacePoint API** é o coração da plataforma SpacePoint, responsável pelo processamento de dados, integrações de pagamento, segurança e gerenciamento de banco de dados.

## 🛠️ Tecnologias Utilizadas

- **Node.js & Express**: Framework veloz e escalável para APIs.
- **Prisma ORM**: Gerenciamento de banco de dados com segurança de tipos.
- **PostgreSQL/MySQL**: Banco de dados relacional para persistência de dados.
- **JWT (JSON Web Token)**: Autenticação segura e escalável.
- **Bcryptjs**: Criptografia de senhas e segurança das contas.
- **Nodemailer**: Sistema de envio de e-mails transacionais.
- **Sharp**: Otimização e processamento de imagens de alta performance.
- **Efi SDK**: Integração robusta para pagamentos (PIX, cartões, etc).

## ⚙️ Funcionalidades principais

- **RBAC (Role-Based Access Control)**: Sistema completo de cargos e permissões granulares.
- **Integração de Pagamentos**: Processamento automático de vendas via gateways.
- **Gestão de Produtos e Estoque**: Endpoints otimizados para CRUD e controle de inventário.
- **Segurança Avançada**: Rate limiting, Helmet e validações com Zod.
- **Entrega Automática**: Sistema de entrega de produtos digitais pós-venda.
- **Logs e Monitoramento**: Rastreamento de atividades administrativas.

## 🚀 Como Iniciar

1. Instale as dependências:
   ```bash
   pnpm install
   ```

2. Configure o banco de dados e as variáveis no `.env`:
   ```env
   DATABASE_URL="your-database-url"
   JWT_SECRET="your-secret"
   ```

3. Execute as migrações do banco de dados:
   ```bash
   npx prisma migrate dev
   ```

4. Popule o banco com dados iniciais (opcional):
   ```bash
   pnpm prisma db seed
   ```

5. Inicie o servidor:
   ```bash
   pnpm run dev
   ```

## 📄 Licença

Este projeto é privado e de uso exclusivo da SpacePoint.
