-- Central de Ajuda · artigo "Onde fica o BDI" (chamado #11474: "ONDE EU ENCONTRO O BDI")
-- PROBLEMA PROVADO (RD-38): fn_ajuda_rag_contexto('onde eu encontro o BDI', papel=1) devolve 0 artigos
-- (o único artigo que cita BDI — "Catalogo Servicos" — tem papel_min=2 e é filtrado para o VIEWER),
-- então a Central de Ajuda ESCALA ("a IA não encontrou um artigo"), que foi como o chamado chegou.
-- CORREÇÃO: artigo global (company_id NULL), publicado, papel_min=1 (VIEWER também vê), dedicado ao BDI,
-- com "BDI" em título/resumo/corpo para o FTS (search_tsv é GENERATED de titulo+resumo+corpo_md).
-- Aditiva e idempotente (id fixo, ON CONFLICT DO NOTHING). Não altera nenhum artigo existente.
-- Conteúdo ancorado no código (RD-51, nada inventado):
--   - BDI configurado em Projetos > Configuracoes, aba "Precificacao" (/dashboard/projetos/configuracoes?aba=precificacao)
--     — src/app/dashboard/projetos/configuracoes/page.tsx (BdiSlider/BdiPreview, abre em ?aba=precificacao)
--   - Componentes: administração central, seguros, riscos, garantias, despesas financeiras, lucro, impostos
--   - Fórmula AEC (TCU/SINAPI): BDI = ((1+AC+SG+RI+GA)*(1+DF)*(1+LU))/(1-IM) - 1 — src/components/projetos/BdiPreview.tsx
--   - O total (bdi_total_pct) é recalculado/persistido por fn_projetos_config_salvar e aplicado no preço de venda dos serviços

INSERT INTO public.erp_ajuda_artigo
  (id, company_id, rota_ref, titulo, resumo, corpo_md, vertical, papel_min, fonte, status, is_gap)
VALUES (
  '7b1d4a2e-9c0f-4e61-bf3a-11474bd10045',
  NULL,
  '/dashboard/projetos/configuracoes',
  'Onde fica o BDI (Benefícios e Despesas Indiretas)',
  'Onde encontrar e como configurar o BDI do Hub de Projetos: Projetos > Configurações, aba Precificação. Também dá para abrir pelo atalho "Configurar BDI" no Catálogo de Serviços.',
  $md$O **BDI** (Benefícios e Despesas Indiretas) fica em **Projetos → Configurações → aba "Precificação"**.

Como chegar lá:
- Abra **Projetos → Configurações** e selecione a aba **Precificação** (link direto: `/dashboard/projetos/configuracoes?aba=precificacao`).
- Pelo **Catálogo de Serviços** você também encontra o atalho **"Configurar BDI"**, que abre direto nessa aba.

Nessa tela você ajusta cada componente do BDI (em %):
- **Administração central**
- **Seguros**
- **Riscos**
- **Garantias**
- **Despesas financeiras**
- **Lucro**
- **Impostos**

O sistema calcula o **BDI Total** pela fórmula AEC (padrão TCU/SINAPI):

`BDI = ((1 + Adm + Seguros + Riscos + Garantias) × (1 + Desp. Financeiras) × (1 + Lucro)) ÷ (1 − Impostos) − 1`

Esse percentual total é salvo automaticamente e aplicado sobre o custo dos serviços para formar o **preço de venda**. Qualquer ajuste nos componentes recalcula o BDI Total na hora, com uma prévia do impacto nos serviços.
$md$,
  'hub_construcao',
  1,
  'manual',
  'publicado',
  false
)
ON CONFLICT (id) DO NOTHING;
