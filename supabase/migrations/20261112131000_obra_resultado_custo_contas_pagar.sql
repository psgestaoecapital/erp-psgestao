-- ONDA 2 do Hub — Da obra ao resultado: fecha o elo CONTA A PAGAR -> CUSTO REALIZADO DA OBRA.
-- Problema (pdca_1 + Eng. Chefe): v_obra_resultado_alocado NÃO consumia erp_pagar por centro de custo.
-- Ao lançar uma conta a pagar com o centro de custo de uma obra, o custo NÃO fluía para o "Custo realizado"
-- da obra nem para a margem. Para construtoras (FC Pisos/FCR) isso é central.
--
-- Correção: a view passa a consolidar erp_pagar POR CENTRO DE CUSTO da obra (erp_pagar.centro_custo_id =
-- projetos_obras.centro_custo_id), excluindo canceladas e apagadas (soft-delete), e com guarda de empresa
-- (p.company_id = po.company_id) para nunca cruzar empresas por um mesmo uuid de centro.
--
-- CREATE OR REPLACE VIEW é ADITIVO (append-only): as colunas existentes mantêm nome/tipo/ordem; a nova
-- coluna custo_contas_pagar entra no FIM. margem_alocada passa a descontar também esse custo.
--
-- Prova RD-38 (ROLLBACK, DEMO "Construtora Modelo - DEMO"):
--   - DEMO-OB-002 (0 contas no centro): custo realizado R$ 18.936,99; ao lançar 1 conta de R$ 10.000 no
--     centro da obra, custo realizado -> R$ 28.936,99 e margem_alocada cai exatamente R$ 10.000. O elo funciona.
--   - DEMO-FC-001 (Frigorífico Oeste): as 5 contas já lançadas (R$ 2.460,35) que a view antiga ignorava
--     passam a somar no custo realizado.

CREATE OR REPLACE VIEW public.v_obra_resultado_alocado AS
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
            AND p.status <> 'cancelado'::text
            AND p.centro_custo_id IS NOT NULL
          GROUP BY po.id) cap ON cap.obra_id = r.obra_id;
