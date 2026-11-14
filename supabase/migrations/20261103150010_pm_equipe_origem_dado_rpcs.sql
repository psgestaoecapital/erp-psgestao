-- PDCA P&M · /dashboard/pm/equipe · RD-98 pilar 3 (origem do dado)
-- A tela usa src/lib/pm/equipeCustos.ts, que chama dois RPCs de custo LGPD-gated:
--   fn__mao_obra_pode_ver_individual (quem pode ver salário individual)
--   fn_pm_equipe_custos (custo/hora por pessoa, registra o acesso)
-- Esses dois não constavam em system_screens.rpcs_chamadas da rota -> origem do dado incompleta.
-- Aditiva: apenas completa o metadado; nenhum código de tela muda, nenhuma estrutura é alterada.
-- Idempotente: só acrescenta o que faltar (não duplica).

UPDATE system_screens
SET rpcs_chamadas = (
  SELECT array_agg(DISTINCT rpc ORDER BY rpc)
  FROM unnest(
    COALESCE(rpcs_chamadas, ARRAY[]::text[])
    || ARRAY['fn_pm_equipe_custos','fn__mao_obra_pode_ver_individual']
  ) AS rpc
)
WHERE rota = '/dashboard/pm/equipe';
