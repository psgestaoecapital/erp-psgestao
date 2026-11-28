-- Hub · telas 14 (Obras · lista) e 16 (Cockpit da obra) · RD-38 reconcilia baseline
-- Ambas estavam 'parcial' desde a fotografia de 09/10; o código vivo já atende os requisitos por completo.
--
-- Tela 14 — "PRESERVAR: obras em andamento e concluídas, escopo, dados fiscais,
--   concluir/pausar/cancelar/reabrir, coluna vazia com explicação"
--   src/app/dashboard/projetos/obras/page.tsx:
--     · colunas por situação (Em andamento / Concluídas / Pausadas / Canceladas) + KPIs;
--     · "Ver escopo" -> modal F2 (fn_obra_escopo, adicionar/excluir item);
--     · dados fiscais (cno, codigo_obra_municipal, endereço) com pendência e modal;
--     · transições Concluir / Pausar / Cancelar / Retomar / Reabrir (STATUS_ACOES);
--     · coluna vazia com explicação e próximo passo (data-testid obras-coluna-vazia-*).
--
-- Tela 16 — "PRESERVAR: escolher a obra e ver avanço, custo, margem e pendências numa tela só"
--   src/app/dashboard/projetos/cockpit/page.tsx:
--     · escolher a obra (busca + filtro de situação + filtro de cliente; 1 obra abre direto);
--     · avanço (barra pct_conclusao), custo, margem e pendências ("O que fazer hoje") no mesmo cartão.
--
-- Migration ADITIVA e IDEMPOTENTE: só atualiza as linhas que ainda estiverem 'parcial'.
-- Não toca dado de cliente. RD-52: arquivo + PR.

UPDATE public.blueprint_tela_requisito
SET status_baseline = 'atendido',
    evidencia_baseline = 'Reconciliado (RD-38): colunas por situação + KPIs; "Ver escopo" (fn_obra_escopo); '
      || 'dados fiscais (cno/codigo_obra_municipal/endereço) com pendência e modal; transições '
      || 'Concluir/Pausar/Cancelar/Retomar/Reabrir (STATUS_ACOES); coluna vazia com explicação '
      || '(data-testid obras-coluna-vazia-*). Fonte: src/app/dashboard/projetos/obras/page.tsx. '
      || 'Rota: /dashboard/projetos/obras.'
WHERE id = 'f45991ea-0991-4e25-866e-405281ba8d98'
  AND vertical = 'hub_projetos' AND tela_num = 14
  AND status_baseline = 'parcial';

UPDATE public.blueprint_tela_requisito
SET status_baseline = 'atendido',
    evidencia_baseline = 'Reconciliado (RD-38): escolher a obra (busca + filtro de situação + filtro de cliente; '
      || '1 obra abre direto) e ver avanço (barra pct_conclusao), custo, margem e pendências numa tela só '
      || '(data-testid cockpit-escolher/cockpit-pendencias). Fonte: src/app/dashboard/projetos/cockpit/page.tsx. '
      || 'Rota: /dashboard/projetos/cockpit.'
WHERE id = '82436378-d8cd-4ca5-9833-c666277e9e80'
  AND vertical = 'hub_projetos' AND tela_num = 16
  AND status_baseline = 'parcial';
