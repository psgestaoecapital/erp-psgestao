-- PDCA Hub NÚCLEO FINANCEIRO · v_obra_resultado_alocado · viagem contada 2x em custo/margem
-- Code: code-desenvolvedor-3
--
-- BUG (provado no dado, RD-38, DEMO Construtora b0700000-0000-4000-a000-000000000006):
-- O custo de VIAGEM entrava DUAS vezes no resultado alocado da obra:
--   (1) custo_viagens  = v_viagem_custo_obra (feeds margem_realizada em v_obra_resultado);
--   (2) custo_contas_pagar (cap) = soma de erp_pagar por centro de custo da obra.
-- As viagens são lançadas como contas a pagar NO MESMO centro de custo, então apareciam nas
-- DUAS colunas; como margem_alocada = margem_realizada - mo - rateio - cap e margem_realizada
-- JÁ subtrai custo_viagens, a viagem era subtraída 2x.
--
-- PROVA (RD-38, sem persistir — replicada como SELECT antes do PR):
--   DEMO-FC-001: custo_viagens 2.460,35 = cap 2.460,35; margem_alocada 62.540,96 -> 65.001,31 (+2.460,35)
--   DEMO-OB-001: custo_viagens   984,05 = cap   984,05; margem_alocada    737,44 ->  1.721,49 (+984,05)
--
-- CORREÇÃO (aditiva/idempotente, flag CANÔNICA já existente): toda conta a pagar originada de
-- viagem é gravada com erp_pagar.ref_externa_sistema = 'viagem' (10 linhas hoje, 1 empresa, todas
-- com centro de custo, nenhuma cancelada). Excluímos essas linhas de `cap` — o custo de viagem
-- passa a entrar UMA vez (via custo_viagens). Contas a pagar NÃO-viagem continuam em cap
-- (nenhuma regressão). p.ref_externa_sistema IS DISTINCT FROM 'viagem' também cobre NULL.
--
-- Única mudança vs. definição viva: `AND p.ref_externa_sistema IS DISTINCT FROM 'viagem'` no cap.
-- Preserva security_invoker=true (RLS das tabelas-base vale por company_id).

CREATE OR REPLACE VIEW public.v_obra_resultado_alocado
WITH (security_invoker = true) AS
 SELECT r.obra_id,
    r.company_id,
    r.numero,
    r.nome,
    r.status,
    r.custo_previsto,
    r.receita_prevista,
    r.receita_servico,
    r.receita_material,
    r.custo_material,
    r.custo_viagens,
    r.margem_realizada,
    COALESCE(mo.valor, 0::numeric)::numeric(15,2) AS custo_mao_obra,
    COALESCE(rt.valor, 0::numeric)::numeric(15,2) AS custo_rateio,
    (r.margem_realizada - COALESCE(mo.valor, 0::numeric) - COALESCE(rt.valor, 0::numeric) - COALESCE(cap.valor, 0::numeric))::numeric(15,2) AS margem_alocada,
    COALESCE(cap.valor, 0::numeric)::numeric(15,2) AS custo_contas_pagar
   FROM v_obra_resultado r
     LEFT JOIN ( SELECT projetos_obra_mao_obra_apontamento.obra_id,
            sum(projetos_obra_mao_obra_apontamento.valor) AS valor
           FROM projetos_obra_mao_obra_apontamento
          WHERE projetos_obra_mao_obra_apontamento.excluido_em IS NULL
          GROUP BY projetos_obra_mao_obra_apontamento.obra_id) mo ON mo.obra_id = r.obra_id
     LEFT JOIN ( SELECT projetos_obra_rateio.obra_id,
            sum(projetos_obra_rateio.valor) AS valor
           FROM projetos_obra_rateio
          WHERE projetos_obra_rateio.excluido_em IS NULL
          GROUP BY projetos_obra_rateio.obra_id) rt ON rt.obra_id = r.obra_id
     LEFT JOIN ( SELECT po.id AS obra_id,
            sum(p.valor) AS valor
           FROM erp_pagar p
             JOIN projetos_obras po ON po.centro_custo_id = p.centro_custo_id AND po.company_id = p.company_id
          WHERE p.deleted_at IS NULL
            AND p.status::text <> 'cancelado'::text
            AND p.centro_custo_id IS NOT NULL
            AND p.ref_externa_sistema IS DISTINCT FROM 'viagem'::text  -- dedup: viagem já em custo_viagens
          GROUP BY po.id) cap ON cap.obra_id = r.obra_id;
