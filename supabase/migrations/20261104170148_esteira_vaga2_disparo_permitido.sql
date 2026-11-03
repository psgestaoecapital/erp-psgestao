-- gilberto-esteira (conserto de infra da esteira): liberar a VAGA 2 do pool do banco de testes
-- no whitelist de disparo de workflow (fn_github_disparar_workflow / erp_github_workflow_permitido).
--
-- PROBLEMA PROVADO (RD-38):
--  * O pool do banco de testes USA a vaga 2: fn_esteira_reservar_vaga sorteia e reserva a vaga 2
--    (erp_esteira_vaga_reserva tem reservas vaga=2 ativas) e o workflow montar-banco-testes.yml
--    aceita vaga como choice ['0','1','2'] (segredos TEST_*_2 provisionados).
--  * MAS o whitelist erp_github_workflow_permitido limitava inputs_regras.vaga.enum a ["0","1"]
--    para montar-banco-testes.yml e reconciliar-vaga.yml. Resultado: toda tentativa do vigia de
--    recriar/reconciliar a vaga 2 era RECUSADA por fn_github_disparar_workflow com
--    "valor inválido para vaga (permitidos: ["0","1"])" (erp_github_disparo_log id=2, 31/10 17:50).
--    Por isso "VAGA 2 DOENTE ... sem substituição": a vaga 2 nunca podia ser auto-recriada.
--
-- CORREÇÃO: alinhar o whitelist à realidade já implantada do workflow (enum passa a ["0","1","2"]).
--  * Vaga 3+ continua recusada (predicado enum @> value da fn, linha ~122 de 20261017230035).
--  * NÃO é destrutiva, NÃO toca dado de cliente/fiscal/financeiro/RLS; só o catálogo interno de
--    dispatch permitido. Idempotente (reaplicar fixa o mesmo valor).
--
-- Prova em produção (BEGIN...ROLLBACK), depois do UPDATE:
--   montar-banco-testes.yml -> enum ["0","1","2"]: aceita_vaga2=true, vaga0/1=true, vaga3=false
--   reconciliar-vaga.yml    -> enum ["0","1","2"]: aceita_vaga2=true, vaga0/1=true, vaga3=false
--
-- NB: a migration-semente 20261017230035 (enum ["0","1"]) e o gate check-github-disparar-workflow.ts
--     NÃO são tocados — eles registram o estado histórico; este arquivo é o fato novo (RD-52).

UPDATE public.erp_github_workflow_permitido
SET inputs_regras = jsonb_set(inputs_regras, '{vaga,enum}', '["0","1","2"]'::jsonb, false),
    descricao = CASE workflow
      WHEN 'montar-banco-testes.yml' THEN 'Montar/recriar o banco de testes da vaga (0, 1 ou 2)'
      WHEN 'reconciliar-vaga.yml'    THEN 'Restaurar a vaga contaminada ao estado da produção (vaga 0, 1 ou 2)'
      ELSE descricao
    END
WHERE workflow IN ('montar-banco-testes.yml', 'reconciliar-vaga.yml')
  AND inputs_regras ? 'vaga';
