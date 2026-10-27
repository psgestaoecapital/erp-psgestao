-- HB1 (fatia 1): resultado por obra — receita (serviço medido + material vendido),
-- custo (material CMV + viagens), previsto × realizado. View NOVA, só leitura,
-- security_invoker (respeita a RLS das tabelas de origem), sem acesso anon.
CREATE OR REPLACE VIEW public.v_obra_resultado
WITH (security_invoker = true) AS
SELECT
  o.id AS obra_id,
  o.company_id,
  o.numero,
  o.nome,
  o.status,
  COALESCE(prev.custo_previsto, 0)::numeric(15,2)  AS custo_previsto,
  COALESCE(prev.valor_contratado, 0)::numeric(15,2) AS receita_prevista,
  COALESCE(med.valor, 0)::numeric(15,2)            AS receita_servico,
  COALESCE(ped.receita, 0)::numeric(15,2)          AS receita_material,
  COALESCE(ped.cmv, 0)::numeric(15,2)              AS custo_material,
  COALESCE(via.valor, 0)::numeric(15,2)            AS custo_viagens,
  (COALESCE(med.valor,0) + COALESCE(ped.receita,0)
   - COALESCE(ped.cmv,0) - COALESCE(via.valor,0))::numeric(15,2) AS margem_realizada
FROM public.projetos_obras o
LEFT JOIN (
  SELECT obra_id,
         SUM(quantidade_contratada * COALESCE(custo_unitario_previsto,0)) AS custo_previsto,
         SUM(valor_contratado) AS valor_contratado
  FROM public.projetos_obra_item WHERE excluido_em IS NULL GROUP BY obra_id
) prev ON prev.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(valor) AS valor FROM public.erp_nfse_obra_medicao
  WHERE estornada_em IS NULL AND descartada_em IS NULL GROUP BY obra_id
) med ON med.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(total) AS receita, SUM(COALESCE(cmv,0)) AS cmv
  FROM public.erp_pedidos WHERE obra_id IS NOT NULL
    AND COALESCE(status,'') NOT IN ('cancelado','cancelada') GROUP BY obra_id
) ped ON ped.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(valor) AS valor FROM public.erp_viagem_lancamento
  WHERE obra_id IS NOT NULL AND excluido_em IS NULL GROUP BY obra_id
) via ON via.obra_id = o.id;

REVOKE ALL ON public.v_obra_resultado FROM anon, PUBLIC;
GRANT SELECT ON public.v_obra_resultado TO authenticated;
