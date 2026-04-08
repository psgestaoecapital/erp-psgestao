# ERP PS GESTÃO E CAPITAL — DOCUMENTAÇÃO TÉCNICA COMPLETA

> **Versão:** 7.3 | **Data:** Abril 2026 | **Confidencial — Uso Interno**
> 
> Este documento contém TODAS as informações necessárias para qualquer desenvolvedor humano ou IA de alta capacidade interpretar, manter e evoluir o sistema ERP PS Gestão e Capital.

---

## ÍNDICE

1. [Visão Geral](#1-visão-geral)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Infraestrutura e Credenciais](#3-infraestrutura-e-credenciais)
4. [Arquitetura do Sistema](#4-arquitetura-do-sistema)
5. [Banco de Dados Completo](#5-banco-de-dados-completo)
6. [Sistema de Segurança](#6-sistema-de-segurança)
7. [Catálogo de Módulos](#7-catálogo-de-módulos)
8. [Catálogo de API Routes](#8-catálogo-de-api-routes)
9. [Catálogo de Componentes](#9-catálogo-de-componentes)
10. [Design System](#10-design-system)
11. [Integrações Externas](#11-integrações-externas)
12. [Guia de Desenvolvimento](#12-guia-de-desenvolvimento)
13. [Deploy e Operação](#13-deploy-e-operação)
14. [Troubleshooting](#14-troubleshooting)
15. [Roadmap](#15-roadmap)
16. [Métricas do Sistema](#16-métricas-do-sistema)

---

## 1. VISÃO GERAL

**O que é:** Plataforma SaaS B2B de inteligência empresarial com IA integrada para PMEs brasileiras.

**O que faz:** Importa dados de ERPs (Omie, ContaAzul, Bling), processa em dashboards executivos, gera relatórios com IA (Claude), classifica lançamentos automaticamente, e produz planos de ação para CEOs e gestores.

**Proposta de valor:** Transformar dados financeiros brutos em inteligência acionável, eliminando planilhas manuais e consultorias pontuais.

**Público-alvo:** PMEs com faturamento R$ 1M a R$ 500M/ano. Segmentos: construção civil, serviços, comércio, indústria (frigoríficos), franquias.

**Diferenciais competitivos:**
- IA nativa em todas as análises (Claude Sonnet 4)
- Dashboard premium com identidade visual exclusiva (dourado sobre preto)
- Relatório V19 CEO Edition (6-18 slides executivos gerados por IA)
- Carta ao Acionista automatizada
- Multi-empresa com consolidação de grupos econômicos
- 12 níveis de acesso granulares
- BPO inteligente com classificação automática de lançamentos

**Modelo de negócio:** Onboarding R$ 30-100K + Licença mensal R$ 3-15K/mês por empresa.

**Empresa:** PS Gestão e Capital — Canal de Capital Assessoria Empresarial
**Fundador:** Gilberto Paravizi (26 anos de experiência em frigoríficos multinacionais)
**Base:** Chapecó/SC e São Miguel do Oeste/SC — Brasil

---

## 2. STACK TECNOLÓGICO

| Camada | Tecnologia | Versão | Função |
|--------|-----------|--------|--------|
| Framework | Next.js | 16.2.2 | SSR, routing, API routes |
| UI | React | 19 | Componentes de interface |
| Linguagem | TypeScript | 5.x | Tipagem estática |
| Banco de Dados | Supabase (PostgreSQL) | 15+ | Banco relacional + Auth + RLS |
| Autenticação | Supabase Auth | — | Email/senha, sessões JWT |
| IA | Claude API (Anthropic) | claude-sonnet-4-20250514 | Relatórios, classificação, agente |
| Hosting Frontend | Vercel | Hobby (upgrade Pro planejado) | Deploy automático, CDN, serverless |
| Hosting Banco | Supabase Cloud | Free (upgrade Pro planejado) | PostgreSQL gerenciado |
| Repositório | GitHub | — | Controle de versão, CI/CD |
| Estilo | CSS-in-JS (inline styles) | — | Design system dourado customizado |
| Bundler | Turbopack | — | Build rápido (integrado ao Next.js 16) |

**Total de código:** 12.406 linhas TypeScript/TSX em 33 arquivos.

---

## 3. INFRAESTRUTURA E CREDENCIAIS

### 3.1 URLs de Acesso

| Ambiente | URL | Branch Git | Finalidade |
|----------|-----|-----------|------------|
| **PRODUÇÃO** | `erp-psgestao.vercel.app` | `main` | Clientes acessam aqui |
| **STAGING** | `erp-psgestao-git-staging-psgestaoecapitals-projects.vercel.app` | `staging` | Teste antes de produção |

### 3.2 Repositório Git

- **URL:** `github.com/psgestaoecapital/erp-psgestao`
- **Branches:** `main` (produção), `staging` (homologação)
- **Acesso:** Conta `psgestaoecapital` no GitHub

### 3.3 Supabase

- **Projeto:** PS Gestao e Capital
- **URL:** `https://horsymhsinqcimflrtjo.supabase.co`
- **Dashboard:** `supabase.com/dashboard/project/horsymhsinqcimflrtjo`
- **Região:** South America (São Paulo)
- **Plano:** Free (upgrade para Pro com 10+ clientes)

### 3.4 Variáveis de Ambiente (Vercel)

| Variável | Descrição | Formato | Onde usar |
|----------|-----------|---------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase | `https://xxx.supabase.co` | Frontend + Backend |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública (anon) | `eyJ...` (JWT legacy) | Frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço (bypassa RLS) | `eyJ...` (JWT legacy) | Apenas Backend (API routes) |
| `ANTHROPIC_API_KEY` | Chave da Claude API | `sk-ant-api03-...` | Apenas Backend (API routes) |

**⚠️ REGRA CRÍTICA:** As chaves do Supabase DEVEM ser no formato **legacy** (começam com `eyJ...`). O formato novo (`sb_secret_...` e `sb_publishable_...`) NÃO funciona com o Supabase JS Client. As chaves legacy ficam em: Supabase → Settings → API Keys → aba "Legacy anon, service_role API keys".

**⚠️ FALLBACK NO CÓDIGO:** O arquivo `src/lib/supabase.ts` e todas as API routes têm as credenciais hardcoded como fallback. Isso garante funcionamento mesmo se as env vars do Vercel estiverem incorretas. Ao rotacionar chaves, atualizar TANTO no Vercel quanto no código.

### 3.5 Chaves Omie (por empresa)

Cada empresa tem suas próprias credenciais Omie armazenadas na tabela `companies`:
- `omie_app_key`: número (ex: `5940802059192`)
- `omie_app_secret`: hash (ex: `25f5fb74f0957ba1a87a6b69cf63f658`)

Configuradas em: Dashboard → Dados → aba Integrações → Omie.

---

## 4. ARQUITETURA DO SISTEMA

### 4.1 Visão Macro (3 Camadas)

```
┌─────────────────────────────────────────────────┐
│                  FRONTEND                        │
│  Next.js 16 + React 19 + TypeScript             │
│  src/app/dashboard/ (16 páginas)                │
│  AuthProvider → segurança centralizada           │
│  CSS-in-JS → design system dourado              │
├─────────────────────────────────────────────────┤
│                 API ROUTES                       │
│  Next.js Serverless Functions                    │
│  src/app/api/ (16 endpoints)                    │
│  SUPABASE_SERVICE_ROLE_KEY → acesso admin       │
│  ANTHROPIC_API_KEY → Claude IA                  │
├─────────────────────────────────────────────────┤
│               BANCO DE DADOS                     │
│  Supabase (PostgreSQL 15+)                      │
│  15+ tabelas com RLS policies                    │
│  Auth integrado (JWT, sessões)                  │
│  Realtime (futuro: notificações)                │
└─────────────────────────────────────────────────┘
```

### 4.2 Fluxo de Dados Principal

```
Omie ERP → /api/omie/sync → omie_imports (JSON bruto)
                                    ↓
              /api/omie/process → Processa DRE, KPIs, gráficos
                                    ↓
              Dashboard (frontend) → Renderiza para o usuário
                                    ↓
              /api/report/v19 → Claude API → Relatório executivo IA
```

### 4.3 Fluxo de Autenticação

```
1. Usuário acessa erp-psgestao.vercel.app
2. Página login (src/app/page.tsx) → supabase.auth.signInWithPassword()
3. Supabase retorna JWT com user_id
4. Redirect para /dashboard
5. Layout carrega → verifica auth → se não logado, redirect para /
6. AuthProvider carrega → user, role, companies autorizadas
7. Cada página usa dados do AuthProvider (ou carrega próprios com filtro)
```

### 4.4 Estrutura de Diretórios Completa

```
erp-psgestao/
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Login (169 linhas)
│   │   ├── invite/[code]/page.tsx            # Aceitar convite
│   │   ├── layout.tsx                        # Root layout
│   │   ├── dashboard/
│   │   │   ├── layout.tsx                    # Dashboard layout (header, nav, auth check)
│   │   │   ├── page.tsx                      # Dashboard principal (1716 linhas) ★
│   │   │   ├── admin/page.tsx                # Painel administrativo (559 linhas)
│   │   │   ├── dados/page.tsx                # Entrada de dados (1374 linhas) ★
│   │   │   ├── dev/page.tsx                  # Central de desenvolvimento (386 linhas)
│   │   │   ├── ficha-tecnica/page.tsx        # Fichas técnicas (554 linhas)
│   │   │   ├── orcamento/page.tsx            # Orçamento (373 linhas)
│   │   │   ├── rateio/page.tsx               # Rateio de custos (432 linhas)
│   │   │   ├── viabilidade/page.tsx          # Análise de viabilidade (282 linhas)
│   │   │   ├── tutorial/page.tsx             # Tutorial/ajuda (305 linhas)
│   │   │   ├── sugestoes/page.tsx            # Sugestões (284 linhas)
│   │   │   ├── conectores/page.tsx           # Conectores ERP (192 linhas)
│   │   │   ├── bpo/
│   │   │   │   ├── page.tsx                  # BPO hub (265 linhas)
│   │   │   │   ├── automacao/page.tsx        # Automação IA (289 linhas)
│   │   │   │   ├── conciliacao/page.tsx      # Conciliação cartão (204 linhas)
│   │   │   │   ├── rotinas/page.tsx          # Rotinas BPO (304 linhas)
│   │   │   │   └── supervisor/page.tsx       # Supervisor (259 linhas)
│   │   │   └── components/
│   │   │       ├── AgenteIA.tsx              # Agente IA flutuante (212 linhas)
│   │   │       ├── AnaliseIAFlags.tsx        # Flags IA (157 linhas)
│   │   │       ├── BalancoPatrimonial.tsx    # Balanço (313 linhas)
│   │   │       ├── FluxoCaixa.tsx            # Fluxo de caixa (314 linhas)
│   │   │       └── IndicadoresFinanceiros.tsx # Indicadores (376 linhas)
│   │   └── api/
│   │       ├── agente/route.ts               # Agente IA (191 linhas)
│   │       ├── conciliacao/route.ts          # Conciliação cartão (292 linhas)
│   │       ├── omie/
│   │       │   ├── route.ts                  # Proxy Omie (33 linhas)
│   │       │   ├── sync/route.ts             # Importação Omie (130 linhas)
│   │       │   ├── process/route.ts          # Processamento dados (228 linhas) ★
│   │       │   └── detail/route.ts           # Detalhamento conta (112 linhas)
│   │       ├── report/
│   │       │   ├── route.ts                  # Relatório rápido (119 linhas)
│   │       │   ├── v19/route.ts              # Relatório V19 CEO (275 linhas) ★
│   │       │   ├── analyze/route.ts          # Análise situacional (74 linhas)
│   │       │   └── test/route.ts             # Teste API Claude (32 linhas)
│   │       ├── bpo/classify/route.ts         # Classificação IA (200 linhas)
│   │       ├── ficha-tecnica/
│   │       │   ├── produtos/route.ts         # Busca produtos ERP (85 linhas)
│   │       │   └── seed/route.ts             # Seed fichas demo (207 linhas)
│   │       └── contaazul/
│   │           ├── callback/route.ts         # OAuth callback (62 linhas)
│   │           ├── sync/route.ts             # Sync ContaAzul (144 linhas)
│   │           └── token/route.ts            # Token exchange (41 linhas)
│   └── lib/
│       ├── supabase.ts                       # Cliente Supabase (7 linhas)
│       ├── auth.ts                           # getAuthorizedCompanies() (29 linhas)
│       └── AuthProvider.tsx                  # Contexto de segurança (130 linhas) ★
├── public/
│   └── ps-gestao-logo.png                    # Logo dourada
├── docs/
│   └── DOCUMENTACAO_TECNICA.md               # Este documento
├── package.json
├── next.config.ts
└── tsconfig.json
```

★ = Arquivos críticos (maiores ou mais importantes)

---

## 5. BANCO DE DADOS COMPLETO

### 5.1 Tabela: companies

Armazena dados cadastrais e credenciais de cada empresa.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| razao_social | TEXT | NULL | — | Razão social |
| nome_fantasia | TEXT | NULL | — | Nome fantasia |
| cnpj | TEXT | NULL | — | CNPJ ou ID fiscal |
| cidade_estado | TEXT | NULL | — | Cidade/UF |
| setor | TEXT | NULL | — | Setor de atuação |
| num_colaboradores | INT | NULL | — | Número de funcionários |
| faturamento_anual | NUMERIC | NULL | — | Faturamento anual estimado |
| omie_app_key | TEXT | NULL | — | Chave Omie API |
| omie_app_secret | TEXT | NULL | — | Secret Omie API |
| pais | TEXT | NULL | 'Brasil' | País |
| moeda | TEXT | NULL | 'BRL' | Moeda |
| regime_tributario | TEXT | NULL | 'simples' | Regime: simples, presumido, real |
| tipo_empresa | TEXT | NULL | 'matriz' | Tipo: matriz, filial |
| id_fiscal_exterior | TEXT | NULL | — | ID fiscal internacional |
| group_id | UUID | NULL | — | FK → company_groups.id |
| created_at | TIMESTAMPTZ | NULL | NOW() | Data criação |

### 5.2 Tabela: users

Perfil do usuário (complementa auth.users do Supabase).

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | — | PK = auth.users.id |
| email | TEXT | NULL | — | Email |
| full_name | TEXT | NULL | — | Nome completo |
| role | TEXT | NULL | 'visualizador' | Role global (constraint: adm, socio, diretor_industrial, gerente_planta, financeiro, comercial, supervisor, coordenador, operacional, consultor, conselheiro, visualizador) |
| org_id | UUID | NULL | — | FK → organizations.id |
| created_at | TIMESTAMPTZ | NULL | NOW() | Data criação |

### 5.3 Tabela: user_companies (SEGURANÇA)

**Tabela mais importante para segurança.** Define QUEM vê QUAIS empresas.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| user_id | UUID | NOT NULL | — | FK → users.id |
| company_id | UUID | NOT NULL | — | FK → companies.id |
| role | TEXT | NULL | — | Role específico nesta empresa |
| created_at | TIMESTAMPTZ | NULL | NOW() | Data vínculo |

**Regra:** Se um registro NÃO existe em user_companies para (user_id, company_id), o usuário NÃO vê a empresa. Exceção: role='adm' vê tudo (verificado no código, não no banco).

### 5.4 Tabela: company_groups

Agrupa empresas do mesmo grupo econômico.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| nome | TEXT | NOT NULL | — | Nome do grupo |
| cor | TEXT | NULL | '#C6973F' | Cor do grupo no UI |
| created_at | TIMESTAMPTZ | NULL | NOW() | Data criação |

### 5.5 Tabela: invites

Convites para novos usuários.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| invite_code | TEXT | NOT NULL | — | Código único do convite |
| email | TEXT | NULL | — | Email convidado |
| role | TEXT | NULL | 'visualizador' | Role que será atribuído |
| company_id | UUID | NULL | — | FK → companies.id (empresa individual) |
| group_id | UUID | NULL | — | FK → company_groups.id (grupo inteiro) |
| is_used | BOOLEAN | NULL | false | Se já foi aceito |
| used_by | UUID | NULL | — | FK → auth.users.id |
| created_at | TIMESTAMPTZ | NULL | NOW() | Data criação |

**Lógica de aceitação:** Se group_id preenchido → cria user_companies para TODAS as empresas do grupo. Se company_id preenchido → cria apenas para 1 empresa.

### 5.6 Tabela: omie_imports

Dados brutos importados do Omie. Cada registro é um tipo de dado (categorias, clientes, contas_pagar, etc.) para uma empresa.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| company_id | UUID | NOT NULL | — | FK → companies.id |
| import_type | TEXT | NOT NULL | — | Tipo: categorias, clientes, produtos, contas_pagar, contas_receber, vendas, estoque, resumo, empresa |
| import_data | JSONB | NULL | — | Dados brutos do Omie (array de objetos) |
| record_count | INT | NULL | 0 | Quantidade de registros |
| imported_at | TIMESTAMPTZ | NULL | NOW() | Data da importação |

**Tamanho:** import_data pode ter milhares de registros JSON. Exemplo: contas_pagar com 4000+ lançamentos.

### 5.7 Tabela: business_lines

Linhas de negócio de cada empresa.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| company_id | UUID | NOT NULL | — | FK → companies.id |
| nome | TEXT | NOT NULL | — | Nome da linha |
| tipo | TEXT | NULL | 'Serviço' | Tipo: Comércio, Serviço, Indústria |
| produtos | INT | NULL | 0 | Quantidade de produtos/serviços |
| pessoas | INT | NULL | 0 | Pessoas alocadas |
| created_at | TIMESTAMPTZ | NULL | NOW() | Data criação |

### 5.8 Tabela: business_line_config

Configuração de rateio e custos por linha de negócio.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| company_id | UUID | NOT NULL | — | FK → companies.id |
| line_id | UUID | NOT NULL | — | FK → business_lines.id |
| mes | TEXT | NOT NULL | — | Mês (formato: '2026-01') |
| faturamento | NUMERIC | NULL | 0 | Faturamento bruto |
| impostos | NUMERIC | NULL | 0 | Impostos |
| custos_diretos | NUMERIC | NULL | 0 | Custos diretos |
| custo_pessoal | NUMERIC | NULL | 0 | Custo de pessoal |
| rateio_pct | NUMERIC | NULL | 0 | Percentual de rateio da estrutura |

### 5.9 Tabela: orcamento

Orçamento mensal por empresa.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| company_id | UUID | NOT NULL | — | FK → companies.id |
| mes | TEXT | NOT NULL | — | Mês (formato: '2026-01') |
| categoria | TEXT | NOT NULL | — | Categoria orçamentária |
| valor | NUMERIC | NULL | 0 | Valor orçado |
| tipo | TEXT | NULL | — | Tipo: receita, despesa |
| created_at | TIMESTAMPTZ | NULL | NOW() | Data criação |

### 5.10 Tabela: fichas_tecnicas

Fichas técnicas de produtos.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| company_id | UUID | NOT NULL | — | FK → companies.id |
| codigo | TEXT | NULL | — | Código da ficha |
| nome | TEXT | NOT NULL | — | Nome do produto |
| categoria | TEXT | NULL | — | Categoria |
| unidade | TEXT | NULL | 'un' | Unidade de medida |
| rendimento | NUMERIC | NULL | 1 | Rendimento/porções |
| created_at | TIMESTAMPTZ | NULL | NOW() | Data criação |

### 5.11 Tabela: ficha_itens

Itens/materiais de cada ficha técnica.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | UUID | NOT NULL | gen_random_uuid() | PK |
| ficha_id | UUID | NOT NULL | — | FK → fichas_tecnicas.id |
| company_id | UUID | NOT NULL | — | FK → companies.id |
| codigo | TEXT | NULL | — | Código do item |
| nome | TEXT | NOT NULL | — | Nome do material |
| quantidade | NUMERIC | NULL | 0 | Quantidade utilizada |
| unidade | TEXT | NULL | 'un' | Unidade |
| preco_unitario | NUMERIC | NULL | 0 | Preço unitário R$ |

### 5.12 Tabelas Adicionais

| Tabela | Função | Colunas Principais |
|--------|--------|--------------------|
| balanco_patrimonial | Dados do balanço | company_id, periodo, ativo_circulante, passivo_circulante, patrimonio_liquido |
| financiamentos | Financiamentos e empréstimos | company_id, banco, valor, taxa, parcelas, vencimento |
| conciliacao_cartao | Conciliações de cartão | company_id, operadora, periodo, status |
| conciliacao_itens | Itens de cada conciliação | conciliacao_id, descricao, valor, data, match_score |
| sugestoes | Sugestões de usuários | user_id, titulo, descricao, status, resposta |
| api_integrations | Tokens de APIs externas | company_id, provider, access_token, refresh_token |
| dev_chat | Histórico do Chat Dev | pergunta, resposta, created_at |
| plans | Planos de assinatura | nome, preco, features |
| organizations | Organizações | nome, owner_id |

---

## 6. SISTEMA DE SEGURANÇA

### 6.1 Arquitetura em Camadas

```
CAMADA A — AuthProvider (React Context) .............. ATIVO ✅
  └ Verifica autenticação e role
  └ Filtra empresas: admin=todas, outros=user_companies
  └ Disponibiliza para TODAS as páginas via useAuth()

CAMADA B — Filtro por página (código) ................ ATIVO ✅
  └ Cada página verifica role individualmente
  └ Dashboard, Dados, Ficha Técnica, Orçamento, BPO, Agente IA
  └ Se admin: SELECT * FROM companies
  └ Se outro: SELECT FROM user_companies WHERE user_id = X

CAMADA C — RLS no PostgreSQL ......................... PARCIAL ⚠️
  └ Policies "allow_all" em todas as tabelas (permissivo)
  └ Planejado: policies restritivas testadas em staging

CAMADA D — Testes automáticos ....................... PLANEJADO 📋
  └ Script pré-deploy que verifica acessos
```

### 6.2 AuthProvider — Implementação

**Arquivo:** `src/lib/AuthProvider.tsx` (130 linhas)

**Fluxo:**
1. `supabase.auth.getUser()` → obtém usuário logado
2. `SELECT role FROM users WHERE id = user.id` → obtém role
3. Se role = 'adm' → `SELECT * FROM companies`
4. Se outro role → `SELECT companies(*) FROM user_companies WHERE user_id = user.id`
5. Expõe via React Context: `user, userId, role, isAdmin, companies, companyIds, groups, canAccess()`

**Hook:** `const { isAdmin, companies, canAccess } = useAuth();`

### 6.3 12 Níveis de Acesso

| Role | Nome | Abas Permitidas | Vê Admin? |
|------|------|----------------|-----------|
| adm | Administrador | TODAS | SIM |
| socio | Sócio/CEO | geral, negocios, resultado, financeiro, precos, relatorio | NÃO |
| diretor_industrial | Diretor Industrial | geral, negocios, resultado, financeiro, precos | NÃO |
| gerente_planta | Gerente de Planta | geral, negocios, resultado, financeiro | NÃO |
| financeiro | Financeiro | geral, resultado, financeiro, precos | NÃO |
| comercial | Comercial | geral, negocios, precos | NÃO |
| supervisor | Supervisor | geral, negocios, resultado | NÃO |
| coordenador | Coordenador | geral, negocios, resultado | NÃO |
| operacional | Operacional | geral, negocios | NÃO |
| consultor | Consultor Externo | geral, negocios, resultado, financeiro, precos, relatorio | NÃO |
| conselheiro | Conselheiro | geral, resultado, financeiro, relatorio | NÃO |
| visualizador | Visualizador | geral | NÃO |

### 6.4 Páginas Admin-Only

| Página | URL | Proteção |
|--------|-----|----------|
| Admin | /dashboard/admin | checkAuth() verifica role='adm', mostra 🔒 se não |
| Dev Central | /dashboard/dev | checkAuth() verifica role='adm', mostra 🔒 se não |

**Header:** Botões ⚙️ Admin e 🛠️ Dev só aparecem se `userRole === "adm"`.

### 6.5 Convites e Onboarding

**Fluxo de convite:**
1. Admin gera convite (Admin → Convites → + Gerar)
2. Define: email, role, empresa ou grupo
3. Sistema gera código único e URL: `/invite/[code]`
4. Novo usuário acessa URL → cria conta → sistema:
   - Cria registro em `users` com role do convite
   - Se group_id: cria `user_companies` para TODAS empresas do grupo
   - Se company_id: cria `user_companies` para 1 empresa
   - Marca convite como `is_used = true`

---

## 7. CATÁLOGO DE MÓDULOS

### 7.1 Dashboard Principal (1716 linhas) ★

**Arquivo:** `src/app/dashboard/page.tsx`
**URL:** `/dashboard`

**8 abas:** Painel Geral, Negócios, Resultado, Balanço, Indicadores, Financeiro, Preços, Relatório, BPO

**Painel Geral:** KPIs (receitas, despesas, resultado, margem, clientes), gráfico mensal, alertas (resultado negativo, empréstimos como receita, lançamentos sem categoria, títulos atrasados).

**Negócios:** Lista de linhas de negócio com drill-down. Dentro de cada linha: faturamento, custos, margem direta, rateio da estrutura, lucro real.

**Resultado:** DRE analítico mensal com expand/collapse. Mapa de custos (13 grupos com orçado vs realizado). Análise IA por grupo de custo.

**Balanço:** Componente BalancoPatrimonial (ativo, passivo, PL, indicadores).

**Indicadores:** Componente IndicadoresFinanceiros (26 indicadores: PE, Margem EBITDA, ROE, Liquidez, Div/EBITDA, Ciclo Financeiro).

**Financeiro:** Componente FluxoCaixa (fluxo diário, saldo acumulado, análise IA).

**Preços:** Formação de preço por linha de negócio (markup, margem, ponto de equilíbrio).

**Relatório:** Geração de relatório IA (rápido 6 slides ou V19 completo).

**BPO:** Link para módulo BPO.

**Dados carregados de:** `/api/omie/process` (processamento dos dados brutos do Omie).

### 7.2 Entrada de Dados (1374 linhas) ★

**Arquivo:** `src/app/dashboard/dados/page.tsx`
**URL:** `/dashboard/dados`

**7 abas:** Empresa, Linhas de Negócio, Resultado/Mês, Custos Estrutura, Painel de Contexto, Plano de Ação, Integrações.

**Empresa:** Cadastro (razão social, CNPJ, cidade, setor, colaboradores).
**Linhas de Negócio:** CRUD de linhas (nome, tipo, produtos, pessoas).
**Resultado/Mês:** Receitas e despesas manuais por mês e linha.
**Custos Estrutura:** Custos fixos da empresa (aluguel, folha admin, etc.).
**Painel de Contexto:** Texto livre para IA usar como contexto.
**Plano de Ação:** Ações com prazo, responsável, status.
**Integrações:** Configuração Omie (App Key/Secret), teste de conexão, importação de dados.

### 7.3 BPO Inteligente

**Hub:** `src/app/dashboard/bpo/page.tsx` → `/dashboard/bpo`
**Supervisor:** `bpo/supervisor/page.tsx` — Visão consolidada multi-empresa.
**Automação IA:** `bpo/automacao/page.tsx` — Classificação automática de lançamentos via Claude.
**Conciliação Cartão:** `bpo/conciliacao/page.tsx` — Upload OFX/CSV, matching automático (score ≥70 auto, 45-69 sugestão, <45 sem match).
**Rotinas:** `bpo/rotinas/page.tsx` — Rotinas operacionais de BPO.

### 7.4 a 7.8 (outros módulos)

| Módulo | Arquivo | URL | Função |
|--------|---------|-----|--------|
| Ficha Técnica | ficha-tecnica/page.tsx | /dashboard/ficha-tecnica | 50 fichas, 35 materiais, integração estoque |
| Orçamento | orcamento/page.tsx | /dashboard/orcamento | Real vs orçado, variação |
| Rateio | rateio/page.tsx | /dashboard/rateio | Rateio de custos da estrutura por linha |
| Viabilidade | viabilidade/page.tsx | /dashboard/viabilidade | Análise de viabilidade de projetos |
| Admin | admin/page.tsx | /dashboard/admin | Empresas, grupos, usuários, convites |
| Dev Central | dev/page.tsx | /dashboard/dev | Ambientes, Chat Dev, Segurança, Changelog |
| Tutorial | tutorial/page.tsx | /dashboard/tutorial | Guia de uso do sistema |
| Sugestões | sugestoes/page.tsx | /dashboard/sugestoes | Sugestões de melhorias |

---

## 8. CATÁLOGO DE API ROUTES

### 8.1 /api/omie (POST) — Proxy Omie

Proxy genérico para qualquer endpoint da API Omie.

**Request:** `{ app_key, app_secret, endpoint, method, params }`
**Response:** Resposta da Omie (JSON)

### 8.2 /api/omie/sync (POST) — Importação Omie

Importa todos os dados do Omie para omie_imports.

**Request:** `{ app_key, app_secret, sync_type: "all" }`
**Response:** `{ success, data: { categorias, clientes, produtos, contas_pagar, contas_receber, vendas, estoque, resumo } }`

**Dados importados:** empresa, categorias, clientes, produtos, contas_pagar, contas_receber, vendas (pedidos faturados), estoque, resumo financeiro, contas bancárias.

### 8.3 /api/omie/process (POST) — Processamento ★

Processa dados brutos do omie_imports em DRE, KPIs e gráficos.

**Request:** `{ company_ids: string[], periodo_inicio: "YYYY-MM", periodo_fim: "YYYY-MM" }`
**Response:** `{ success, data: { total_receitas, total_despesas, resultado_periodo, margem, num_clientes, num_empresas, dre_mensal, top_custos, top_receitas_operacionais, raw_rec, raw_desp, total_emprestimos } }`

**Lógica:** Lê contas_pagar e contas_receber do omie_imports. Agrupa por mês (parseMesAno). Separa receitas operacionais (categorias 1.xx, 2.xx) de empréstimos (5.xx). Calcula DRE mensal, top custos (Pareto), margem.

### 8.4 /api/omie/detail (POST) — Detalhamento

Detalha uma conta específica (lista de lançamentos).

**Request:** `{ company_ids, categoria_codigo, periodo_inicio, periodo_fim }`
**Response:** `{ success, data: { conta, lancamentos } }`

### 8.5 /api/report (POST) — Relatório Rápido

Gera relatório executivo rápido com IA (6 slides).

**Request:** `{ dados: { receita, despesas, resultado, margem, ... }, periodo }`
**Response:** `{ success, content: "texto markdown do relatório" }`

**Modelo IA:** claude-sonnet-4, max_tokens: 4000

### 8.6 /api/report/v19 (POST) — Relatório V19 CEO ★

Relatório completo CEO Edition.

**Request:** `{ company_ids, periodo_inicio, periodo_fim }`
**Response:** `{ success, content: "texto markdown com slides" }`

**Modelo IA:** claude-sonnet-4, max_tokens: 4000 (Hobby) ou 16000 (Pro)
**Timeout:** 60s (Hobby) ou 300s (Pro)

### 8.7 /api/agente (POST) — Agente IA

Responde perguntas sobre a empresa com contexto financeiro.

**Request:** `{ pergunta, company_ids, historico: [{role, content}] }`
**Response:** `{ success, resposta }`

### 8.8 /api/bpo/classify (POST) — Classificação IA

Classifica lançamentos sem categoria automaticamente.

**Request:** `{ company_id }`
**Response:** `{ success, classificacoes, message }`

### 8.9 /api/conciliacao (POST) — Conciliação Cartão

Concilia extrato de cartão (OFX/CSV) com lançamentos Omie.

**Request:** FormData com `file` + `company_id`
**Response:** `{ success, matched, suggested, unmatched, items }`

### 8.10 /api/ficha-tecnica/seed (POST)

Carrega 50 fichas técnicas + 35 materiais base.

**Request:** `{ company_id }`
**Response:** `{ success, fichas_criadas, itens_criados }`

### 8.11 /api/ficha-tecnica/produtos (POST)

Busca produtos importados do Omie para usar em fichas.

**Request:** `{ company_id }`
**Response:** `{ success, produtos: [...] }`

---

## 9. CATÁLOGO DE COMPONENTES

| Componente | Arquivo | Props | Usado em |
|-----------|---------|-------|----------|
| AgenteIA | components/AgenteIA.tsx | — | Layout (todas as páginas) |
| AnaliseIAFlags | components/AnaliseIAFlags.tsx | flags, periodo | Dashboard (Resultado) |
| BalancoPatrimonial | components/BalancoPatrimonial.tsx | companyIds, periodo | Dashboard (Balanço) |
| FluxoCaixa | components/FluxoCaixa.tsx | companyIds, periodo | Dashboard (Financeiro) |
| IndicadoresFinanceiros | components/IndicadoresFinanceiros.tsx | realData, companyIds | Dashboard (Indicadores) |
| AuthProvider | lib/AuthProvider.tsx | children | Layout |

---

## 10. DESIGN SYSTEM

### 10.1 Paleta de Cores

| Variável | Hex | Uso |
|----------|-----|-----|
| GO (Gold) | #C6973F | Bordas, botões, acentos |
| GOL (Gold Light) | #E8C872 | Títulos, destaques |
| BG (Background) | #0C0C0A | Fundo principal |
| BG2 | #161614 | Cards, containers |
| BG3 | #1E1E1B | Inputs, áreas secundárias |
| BD (Border) | #2A2822 | Bordas |
| TX (Text) | #F0ECE3 | Texto principal |
| TXM (Text Medium) | #B0AB9F | Texto secundário |
| TXD (Text Dark) | #918C82 | Texto terciário |
| G (Green) | #22C55E | Positivo, saudável |
| R (Red) | #EF4444 | Negativo, crítico |
| Y (Yellow) | #FACC15 | Alerta, atenção |
| B (Blue) | #3B82F6 | Links, informação |
| P (Purple) | #A78BFA | Destaques especiais |

### 10.2 Tipografia

- **Fonte:** Plus Jakarta Sans (Google Fonts)
- **Tamanhos:** 9px (micro), 10px (small), 11px (caption), 12px (body), 13px (emphasis), 14-16px (heading), 20-28px (title)
- **Pesos:** 400 (normal), 500 (medium), 600 (semibold), 700 (bold)

### 10.3 Padrão de Card

```javascript
const Card = ({title, children}) => (
  <div style={{background:BG2, borderRadius:14, padding:20, border:`1px solid ${BD}`}}>
    {title && <div style={{fontSize:14, fontWeight:600, color:GOL, marginBottom:12}}>{title}</div>}
    {children}
  </div>
);
```

### 10.4 Padrão de Input

```javascript
const inp = {background:BG3, border:`1px solid ${BD}`, color:TX, borderRadius:8, padding:"10px 14px", fontSize:12, outline:"none", width:"100%"};
```

---

## 11. INTEGRAÇÕES EXTERNAS

### 11.1 Omie ERP

**Base URL:** `https://app.omie.com.br/api/v1/`
**Autenticação:** `app_key` + `app_secret` por empresa
**Endpoints usados:** geral/empresas, geral/categorias, geral/clientes, geral/produtos, financas/contapagar, financas/contareceber, produtos/pedido, estoque/consulta, financas/resumo
**Rate limit:** Não documentado oficialmente, recomendado max 1 req/s
**Dados armazenados em:** `omie_imports.import_data` (JSONB)

### 11.2 Claude API (Anthropic)

**Base URL:** `https://api.anthropic.com/v1/messages`
**Modelo:** `claude-sonnet-4-20250514`
**Autenticação:** Header `x-api-key`
**Versão:** `anthropic-version: 2023-06-01`
**Uso:** Relatórios, classificação de lançamentos, agente IA, análise de viabilidade

### 11.3 ContaAzul (parcial)

**Tipo:** OAuth 2.0
**Status:** Implementado mas não em uso ativo
**Arquivos:** `/api/contaazul/callback`, `/api/contaazul/sync`, `/api/contaazul/token`

---

## 12. GUIA DE DESENVOLVIMENTO

### 12.1 Pré-requisitos

- Node.js 18+
- npm ou yarn
- Git
- Conta no GitHub (acesso ao repositório)
- Chaves do Supabase e Claude API

### 12.2 Setup Local

```bash
git clone https://github.com/psgestaoecapital/erp-psgestao.git
cd erp-psgestao
npm install
cp .env.example .env.local  # Configurar variáveis
npm run dev                  # http://localhost:3000
```

### 12.3 Como Criar um Novo Módulo

**Passo 1: Criar página**
```
src/app/dashboard/nome-modulo/page.tsx
```

**Passo 2: Estrutura mínima**
```typescript
"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F";

export default function NomeModuloPage() {
  const [empresas, setEmpresas] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      // SEGURANÇA: SEMPRE verificar role
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: up } = await supabase.from("users").select("role").eq("id", user.id).single();
      
      if (up?.role === "adm") {
        const { data } = await supabase.from("companies").select("*");
        setEmpresas(data || []);
      } else {
        const { data: uc } = await supabase.from("user_companies")
          .select("companies(*)").eq("user_id", user.id);
        setEmpresas((uc || []).map(u => u.companies).filter(Boolean));
      }
    };
    load();
  }, []);

  return (
    <div style={{padding:20, maxWidth:1200, margin:"0 auto"}}>
      <h1 style={{color:GOL}}>Nome do Módulo</h1>
      {/* conteúdo */}
    </div>
  );
}
```

**Passo 3: Adicionar link no layout (se necessário)**
Editar `src/app/dashboard/layout.tsx`, adicionar `<a>` no header.

**Passo 4: Deploy**
```bash
git checkout staging
# ... fazer mudanças ...
git add -A && git commit -m "Novo módulo: nome"
git push origin staging      # → deploy automático em staging
# Testar no staging
git checkout main
git merge staging
git push origin main          # → deploy automático em produção
```

### 12.4 Como Criar uma API Route

```typescript
// src/app/api/nome/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'FALLBACK_ANON_KEY';

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    
    // Lógica aqui...
    
    return NextResponse.json({ success: true, data: resultado });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

### 12.5 Padrões Obrigatórios

1. **Segurança:** NUNCA fazer `SELECT * FROM companies` sem verificar role
2. **Cores:** Usar variáveis do design system, não hex hardcoded
3. **Fallback:** API routes DEVEM ter fallback de credenciais hardcoded
4. **Erro:** Sempre retornar `{ error: mensagem }` com status HTTP correto
5. **Tipagem:** Usar TypeScript, evitar `any` quando possível
6. **Staging:** Toda mudança vai para staging ANTES de produção

---

## 13. DEPLOY E OPERAÇÃO

### 13.1 Fluxo de Deploy Seguro

```
1. Desenvolvimento (Claude.ai ou dev local)
2. Push para branch "staging"
3. Vercel auto-deploya em staging
4. Admin testa no staging
5. Se aprovado: merge staging → main (git merge)
6. Vercel auto-deploya em produção
7. Verificar se produção funciona
```

### 13.2 Rollback de Emergência

```
1. Vercel → Deployments
2. Encontrar deploy anterior que funcionava
3. Clicar ⋯ → "Promote to Production"
4. 30 segundos → produção restaurada
```

**ATENÇÃO:** Rollback restaura CÓDIGO, não banco de dados. Se o problema foi no banco (RLS, dados deletados), reverter queries SQL manualmente.

### 13.3 Backup

| O quê | Como | Frequência |
|-------|------|------------|
| Código | GitHub (automático via git push) | A cada commit |
| Banco de dados | Supabase backup automático | Diário (Pro) |
| Documentação | Repositório Git (`/docs`) | A cada commit |
| Env vars | Anotadas neste documento | Manual |

---

## 14. TROUBLESHOOTING

### 14.1 "Conecte seus dados para começar"

**Causa:** `realData` é null — API `/api/omie/process` falhou.
**Verificar:**
1. Console do browser (F12 → Console) — procurar erros "PROCESS"
2. SQL: `SELECT COUNT(*) FROM omie_imports WHERE company_id = 'ID_DA_EMPRESA'`
3. Se 0 imports → empresa não tem dados do Omie importados
4. Se >0 imports → problema na API (verificar logs no Vercel → Logs)

### 14.2 "Invalid API key"

**Causa:** Chave do Supabase incorreta ou expirada.
**Verificar:**
1. Supabase → Settings → API Keys → Legacy → copiar anon key
2. Testar: `https://horsymhsinqcimflrtjo.supabase.co/rest/v1/companies?select=nome_fantasia&limit=1&apikey=CHAVE`
3. Se funcionar → atualizar no Vercel env vars + código `src/lib/supabase.ts`

### 14.3 "sb_secret is an invalid header value"

**Causa:** SUPABASE_SERVICE_ROLE_KEY está no formato novo (sb_secret_...) em vez do legacy (eyJ...).
**Solução:** Usar chave no formato legacy JWT.

### 14.4 Usuário vê empresas de outros

**Causa:** Filtro de segurança não aplicado na página.
**Verificar:**
1. A página usa `up?.role === "adm"` antes de `SELECT * FROM companies`?
2. Para não-admin, usa `user_companies` com `WHERE user_id = user.id`?
3. Verificar com: Dev Central → Segurança → Verificar Acessos

### 14.5 Deploy falhou

**Verificar:**
1. Vercel → Deployments → clicar no deploy com erro → Build Logs
2. Se TypeScript error → corrigir tipo no código
3. Se npm error → verificar package.json e node_modules

---

## 15. ROADMAP

| Fase | Meta | Funcionalidades |
|------|------|----------------|
| Fase 1 | Até 30 clientes | Dashboard, BPO, Ficha Técnica, Relatório IA, Orçamento |
| Fase 2 | 10+ clientes | Contas a pagar/receber próprias, módulo financeiro |
| Fase 3 | 30+ clientes | Conciliação bancária (Pluggy/Belvo), DDA |
| Fase 4 | 50+ clientes | NF-e (eNotas/Focus), gestão documental |
| Fase 5 | 24 meses | Plataforma completa, substitui Omie/ContaAzul com IA |

**Módulo Contador (futuro):** API REST para contadores parceiros. Fases: MVP read-only → SPED → bidirecional → marketplace.

**Vertical Frigoríficos:** OEE, Rendimento/Quebras, UEP, KPIs Industriais.

---

## 16. MÉTRICAS DO SISTEMA

| Métrica | Valor |
|---------|-------|
| Total de linhas de código | 12.406 |
| Páginas do dashboard | 16 |
| API routes | 16 |
| Componentes reutilizáveis | 5 |
| Tabelas no banco | 15+ |
| Níveis de acesso | 12 |
| Integrações externas | 3 (Omie, Claude, ContaAzul) |
| Versão atual | 7.3 |

---

*Documento gerado automaticamente — ERP PS Gestão e Capital v7.3 — Abril 2026*
*Atualizar este documento a cada nova versão ou mudança significativa.*
