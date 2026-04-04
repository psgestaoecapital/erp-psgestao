# PS Gestão e Capital — ERP Inteligente com IA

Sistema de gestão empresarial com inteligência artificial para assessoria de empresas de comércio e serviço.

## Tecnologias
- **Next.js 15** — Framework React
- **Supabase** — Banco de dados PostgreSQL + Autenticação
- **Vercel** — Hospedagem e deploy automático
- **Claude API** — Geração de relatórios com IA

## Como Fazer o Deploy

### 1. Configurar o Supabase
1. Acesse supabase.com e abra seu projeto
2. Vá em **SQL Editor** (menu lateral)
3. Cole o conteúdo do arquivo `supabase_schema_v1.sql`
4. Clique em **Run** para criar as tabelas
5. Vá em **Settings > API** e copie:
   - `Project URL` (ex: https://xyz.supabase.co)
   - `anon public key`

### 2. Subir para o GitHub
1. Crie um novo repositório no github.com
2. Nome: `erp-psgestao`
3. Siga as instruções para fazer push do código

### 3. Deploy na Vercel
1. Acesse vercel.com
2. Clique em **Add New Project**
3. Importe o repositório `erp-psgestao` do GitHub
4. Em **Environment Variables**, adicione:
   - `NEXT_PUBLIC_SUPABASE_URL` = URL do Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = chave anon do Supabase
5. Clique em **Deploy**
6. Em 2 minutos o sistema estará no ar!

## Estrutura do Projeto
```
src/
  app/
    page.tsx          — Tela de login
    layout.tsx        — Layout raiz
    globals.css       — Estilos globais (tema dourado)
    dashboard/
      layout.tsx      — Layout do dashboard (com auth)
      page.tsx        — Dashboard principal (4 abas)
  lib/
    supabase.ts       — Conexão com Supabase
```

## PS Gestão e Capital
Assessoria Empresarial e BPO Financeiro
