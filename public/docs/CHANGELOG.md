# ERP PS GESTÃO E CAPITAL — CHANGELOG

> Registro de TODAS as mudanças do sistema, organizado por sessão de desenvolvimento.
> Atualizado automaticamente a cada sessão. Nunca deletar — apenas adicionar.

---

## SESSÃO 08/04/2026 (manhã) — v7.3-fix

### Problema Crítico Resolvido: Chaves do Supabase
- **Causa:** Env vars do Vercel trocadas (URL↔KEY) + formato novo (sb_secret) incompatível
- **Impacto:** Dashboard sem dados por ~4 horas
- **Solução:** Keys hardcoded no código como fallback + correção das env vars

### Segurança Implementada
- AuthProvider centralizado (`src/lib/AuthProvider.tsx`) — React Context
- Filtro de empresas em 7 páginas: Dashboard, Dados, Ficha Técnica, Orçamento, BPO Automação, BPO Conciliação, Agente IA
- Admin oculto no header para não-admin (layout.tsx)
- Admin page bloqueada com 🔒 para não-admin (admin/page.tsx)
- Role carregado no layout antes de renderizar

### Central de Desenvolvimento
- Nova página: `/dashboard/dev` (386 linhas)
- 4 abas: Ambientes, Chat Dev, Segurança, Changelog
- Chat Dev com IA salva histórico no Supabase (tabela dev_chat)
- Auditoria de segurança (quem vê o quê)
- Botão 🛠️ Dev no header (apenas admin)

### Ambiente Staging
- Branch `staging` criada no GitHub
- Deploy automático no Vercel como Preview
- Fluxo: código → staging → testa → merge main → produção

### Documentação
- `docs/DOCUMENTACAO_TECNICA.md` — 979 linhas, 16 capítulos
- `docs/CHANGELOG.md` — este arquivo
- Schema completo do banco, catálogo de APIs, guia de desenvolvimento

### Relatório V19
- Otimizado para Vercel Hobby (60s timeout)
- Reduzido de 18 para 6 slides
- max_tokens: 16000 → 4000
- Plano: restaurar 18 slides com Vercel Pro

### Convite Tryo Gessos
- Convite gerado para gilmarthomas06@gmail.com (role=socio, group_id=Tryo)
- Usuário criou conta com sucesso
- Verificado: vê APENAS 4 empresas Tryo ✅
- Felicita e Toy Tintas NÃO aparecem ✅

### Arquivos Modificados
- `src/lib/supabase.ts` — keys hardcoded
- `src/lib/AuthProvider.tsx` — NOVO
- `src/lib/auth.ts` — NOVO
- `src/app/dashboard/layout.tsx` — AuthProvider + role check + botões admin/dev
- `src/app/dashboard/page.tsx` — segurança + debug temporário (removido)
- `src/app/dashboard/dados/page.tsx` — segurança + carregar chaves Omie
- `src/app/dashboard/ficha-tecnica/page.tsx` — segurança
- `src/app/dashboard/orcamento/page.tsx` — segurança
- `src/app/dashboard/bpo/automacao/page.tsx` — segurança
- `src/app/dashboard/bpo/conciliacao/page.tsx` — segurança
- `src/app/dashboard/components/AgenteIA.tsx` — segurança
- `src/app/dashboard/dev/page.tsx` — NOVO
- `src/app/api/*/route.ts` — keys hardcoded (16 arquivos)
- `src/app/api/report/v19/route.ts` — otimização 60s
- `docs/DOCUMENTACAO_TECNICA.md` — NOVO
- `docs/CHANGELOG.md` — NOVO

---

## SESSÃO 07/04/2026 (noite) — v7.2 → v7.3

### Entregas
- Ficha Técnica expandida (50 fichas, 35 materiais)
- Agente IA flutuante (todas as telas)
- Conciliação de Cartão (OFX/CSV matching)
- Header e BPO reorganizados
- Persistência de empresa selecionada (localStorage)
- Convite por grupo (vincula todas empresas do grupo)
- Excluir convites (individual + em lote)
- 12 níveis de acesso implementados
- Notificação por e-mail em Sugestões
- Fix role "admin" → "adm" em 7 arquivos

### Segurança Crítica
- Isolamento de dados (AuthProvider + código por página)
- RLS implementado e revertido (instabilidade com env vars)
- Crise de keys do Supabase (resolvida com hardcode)

---

## SESSÃO 06-07/04/2026 — v7.1 → v7.2

### Entregas
- Dashboard com 8 abas completas
- DRE analítico com expand/collapse e ABC ordering
- Mapa de custos (13 grupos com orçado vs realizado)
- Indicadores fundamentalistas (26 indicadores)
- Fluxo de caixa diário
- Relatório V19 CEO Edition
- Drill-down por linha de negócio (6 linhas × 5 sub-abas)
- Integração Omie API (import completo)
- Filtro de período flexível
- BPO Supervisor + Automação IA

---

*Regra: Este arquivo é atualizado a cada sessão de desenvolvimento. Nunca deletar entradas.*
