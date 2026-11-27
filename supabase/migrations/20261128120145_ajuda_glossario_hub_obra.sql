-- Central de Ajuda · glossário do Hub de Projetos (EAP, Medição, Resultado/Margem da obra)
-- PROBLEMA PROVADO (RD-38): para o VIEWER (papel 1), fn_ajuda_rag_contexto devolve 0 artigos em termos
-- centrais do Hub — "o que é EAP", "o que é medição de obra", "como ver a margem da obra" todos escalam.
-- CORREÇÃO: 3 artigos globais (company_id NULL), publicados, papel_min=1, ancorados nas TELAS QUE EXISTEM
-- (RD-51, nada inventado — rotas conferidas em src/app/dashboard/projetos/obras/[id]/{orcamento,medicoes,cockpit}):
--   - Orçamento por EAP     -> obra > aba Orçamento  (/dashboard/projetos/obras/[id]/orcamento)
--   - Medição de obra        -> obra > aba Medições   (/dashboard/projetos/obras/[id]/medicoes)
--   - Resultado/Margem       -> obra > aba Cockpit    (/dashboard/projetos/obras/[id]/cockpit) e Acompanhamento
-- Aditiva e idempotente (ids fixos, ON CONFLICT DO NOTHING). Não altera nenhum artigo existente.

INSERT INTO public.erp_ajuda_artigo
  (id, company_id, rota_ref, titulo, resumo, corpo_md, vertical, papel_min, fonte, status, is_gap)
VALUES
(
  'a2e11474-0001-4a10-9c0f-1286120145ea',
  NULL,
  '/dashboard/projetos/obras',
  'O que é a EAP (orçamento por EAP) e onde fica',
  'A EAP organiza o orçamento da obra em itens e subitens. Fica na obra, na aba Orçamento (Projetos → Obras → abra a obra → Orçamento).',
  $md$A **EAP** (Estrutura Analítica do Projeto) é a forma de organizar o **orçamento da obra** em itens e subitens (níveis), separando **material** e **mão de obra** por item.

Onde encontrar:
- **Projetos → Obras** → abra a obra → aba **Orçamento**.
- Dá para **importar** o orçamento de uma planilha pela opção de importação dentro dessa mesma tela.

Nela você monta a composição de cada item, acompanha o **custo por m²** e compara versões do orçamento.
$md$,
  'hub_construcao', 1, 'manual', 'publicado', false
),
(
  'a2e11474-0002-4a10-9c0f-1286120145ea',
  NULL,
  '/dashboard/projetos/obras',
  'O que é medição de obra e onde registrar',
  'A medição registra quanto de cada item/serviço foi executado no período. Fica na obra, na aba Medições (Projetos → Obras → abra a obra → Medições).',
  $md$A **medição de obra** registra **quanto de cada item ou serviço foi executado** em um período, servindo de base para o faturamento e para o pagamento de empreiteiros.

Onde encontrar:
- **Projetos → Obras** → abra a obra → aba **Medições**.

A medição alimenta o avanço da obra e o fluxo de pagamento; a geração do título financeiro segue o processo da Gestão Empresarial.
$md$,
  'hub_construcao', 1, 'manual', 'publicado', false
),
(
  'a2e11474-0003-4a10-9c0f-1286120145ea',
  NULL,
  '/dashboard/projetos/obras',
  'Como ver a margem e o resultado da obra',
  'O resultado (receita, custo e margem) da obra fica no Cockpit da obra e em Acompanhamento. Projetos → Obras → abra a obra → Cockpit.',
  $md$O **resultado da obra** (receita, custo e **margem**) aparece no **Cockpit da obra**, que reúne avanço, custo, margem e pendências numa tela só.

Onde encontrar:
- **Projetos → Obras** → abra a obra → aba **Cockpit**.
- A visão consolidada por obra também está em **Projetos → Acompanhamento** (Resultado por obra).

Os custos que entram no resultado vêm dos lançamentos de custo da obra (aba **Custos**), da mão de obra apontada e das notas/compras apropriadas à obra.
$md$,
  'hub_construcao', 1, 'manual', 'publicado', false
)
ON CONFLICT (id) DO NOTHING;
