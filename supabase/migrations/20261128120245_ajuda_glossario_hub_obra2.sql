-- Central de Ajuda · glossário do Hub (parte 2): Custos da obra, RDO/Diário, Cronograma/Curva S
-- PROBLEMA PROVADO (RD-38): para o VIEWER (papel 1) a Central de Ajuda escalava "como lançar custo na obra",
-- "o que é RDO/diário de obra", "o que é curva S / físico-financeiro" (0 artigos).
-- CORREÇÃO: 3 artigos globais, publicados, papel_min=1, ancorados nas telas que EXISTEM (RD-51 — conferido em
-- src/app/dashboard/projetos/obras/[id]/{custos,rdo,cronograma}/page.tsx):
--   - Custos      -> obra > aba Custos      (lançar custo/pagamento da obra)
--   - RDO/Diário  -> obra > aba RDO         (fn_obra_rdo_salvar; diário por OS, vira % físico)
--   - Cronograma  -> obra > aba Cronograma  (Gantt, curva S linha-de-base × planejado, histograma)
-- Aditiva e idempotente (ids fixos, ON CONFLICT DO NOTHING). Não altera nenhum artigo existente.

INSERT INTO public.erp_ajuda_artigo
  (id, company_id, rota_ref, titulo, resumo, corpo_md, vertical, papel_min, fonte, status, is_gap)
VALUES
(
  'a2e11474-0004-4a10-9c0f-1286120245ea',
  NULL,
  '/dashboard/projetos/obras',
  'Como lançar um custo na obra',
  'Os custos e pagamentos da obra são lançados na obra, na aba Custos (Projetos → Obras → abra a obra → Custos).',
  $md$Os **custos e pagamentos da obra** são lançados na própria obra.

Onde encontrar:
- **Projetos → Obras** → abra a obra → aba **Custos**.

Ali você informa o **valor**, o **fornecedor** (opcional) e a **descrição** do que foi comprado ou pago. Esses lançamentos entram no **resultado da obra** (receita × custo × margem) que aparece no Cockpit. Também compõem o resultado as notas/compras apropriadas à obra e a mão de obra apontada.
$md$,
  'hub_construcao', 1, 'manual', 'publicado', false
),
(
  'a2e11474-0005-4a10-9c0f-1286120245ea',
  NULL,
  '/dashboard/projetos/obras',
  'O que é o RDO (Diário de Obra) e onde registrar',
  'O RDO é o diário da obra, por dia e por OS. Fica na obra, na aba RDO (Projetos → Obras → abra a obra → RDO).',
  $md$O **RDO** (Relatório/Registro Diário de Obra), ou **Diário de Obra**, é o registro do que aconteceu na obra **a cada dia** — por Ordem de Serviço — incluindo ocorrências, clima e fotos.

Onde encontrar:
- **Projetos → Obras** → abra a obra → aba **RDO**.

Você cria ou edita o diário do dia por OS. A **quantidade executada** lançada no diário vira o **% físico** da tarefa no cronograma, mantendo o avanço da obra atualizado sem redigitar.
$md$,
  'hub_construcao', 1, 'manual', 'publicado', false
),
(
  'a2e11474-0006-4a10-9c0f-1286120245ea',
  NULL,
  '/dashboard/projetos/obras',
  'Cronograma da obra: Gantt, curva S e avanço físico',
  'O cronograma da obra (Gantt, curva S e histograma) fica na obra, na aba Cronograma (Projetos → Obras → abra a obra → Cronograma).',
  $md$O **cronograma da obra** mostra o planejamento e o avanço num só lugar.

Onde encontrar:
- **Projetos → Obras** → abra a obra → aba **Cronograma**.

O que tem nela:
- **Gantt** das tarefas, com a marca de hoje.
- **Curva S**: a **linha de base** comparada ao **planejado atual**, para ver adiantamento ou atraso.
- **Histograma de mão de obra** (horas apontadas por semana) e dias de chuva/parados vindos do diário (RDO).
- O **avanço físico** pode vir do diário: o % executado lançado no RDO entra como % da tarefa ao confirmar.
$md$,
  'hub_construcao', 1, 'manual', 'publicado', false
)
ON CONFLICT (id) DO NOTHING;
