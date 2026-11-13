-- RD-98 p3 (origem do dado): a rota /dashboard/industrial/apontamento estava com
-- views_consumidas e rpcs_chamadas NULOS em system_screens. Preenche a linhagem de dados
-- da tela "Apontamento de Produção — Bovinos".
--
-- Origem real (auditada no código): a tela grava via POST /api/industrial/bovinos/apontamento
-- (ind_turnos, ind_apontamentos_bovinos, ind_qualidade_sif, ind_custos_turno, ind_kpis_diarios),
-- lê as unidades via GET /api/industrial/unidades (ind_unidades) e usa o "?" (AjudaCampo →
-- fn_ajuda_campo_listar). Aditiva/idempotente: só preenche onde ainda está NULL.
UPDATE public.system_screens
SET views_consumidas = ARRAY[
      'ind_unidades',
      'ind_turnos',
      'ind_apontamentos_bovinos',
      'ind_qualidade_sif',
      'ind_custos_turno',
      'ind_kpis_diarios'
    ]::text[],
    rpcs_chamadas = ARRAY['fn_ajuda_campo_listar']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/industrial/apontamento'
  AND views_consumidas IS NULL
  AND rpcs_chamadas IS NULL;
