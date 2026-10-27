-- DEMO Construtora (006) — receita REAL nas obras para o Hub sair do zero (RD-98 p1; aud8 27/10 15:29, caixas be774043/372ac086/2b041264).
-- Resultado por obra, Cockpit e o card "Resultado da obra" liam v_obra_resultado e mostravam R$ 0 em todas as obras da DEMO,
-- porque a semente só tinha escopo/medição física, nunca venda. Aqui entra a venda de material faturada de cada obra em andamento
-- (erp_pedidos.obra_id = receita_material/custo_material da v_obra_resultado), com custo (CMV) menor que a receita.
-- NÃO cria NFS-e (emissão fiscal é bloqueada em DEMO de propósito, trg_bloqueia_emissao_demo) nem toca empresa que não seja DEMO.
-- Idempotente: pedido DEMO-PV-<obra> só é criado se ainda não existe.

DO $$
DECLARE
  v_c constant uuid := 'b0700000-0000-4000-a000-000000000006';
  o record;
  v_total numeric; v_cmv numeric; v_pct numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_c AND is_demo) THEN RETURN; END IF;
  FOR o IN SELECT id, numero, nome, cliente_nome, valor_previsto, status FROM public.projetos_obras
            WHERE company_id = v_c AND deleted_at IS NULL AND numero IN ('DEMO-OB-001','DEMO-OB-002','DEMO-OB-003','DEMO-OB-004','DEMO-FC-001')
  LOOP
    -- material faturado ≈ 30% (em andamento) ou 60% (concluída) do contrato; CMV ≈ 72% da venda (margem de material ~28%)
    v_pct   := CASE WHEN o.status = 'concluida' THEN 0.60 ELSE 0.30 END;
    v_total := round(o.valor_previsto * v_pct, 2);
    v_cmv   := round(v_total * 0.72, 2);
    INSERT INTO public.erp_pedidos (company_id, numero, cliente_nome, data_pedido, data_faturamento, status, subtotal, total, total_pago, cmv, obra_id, observacoes_internas)
    SELECT v_c, 'DEMO-PV-' || o.numero, o.cliente_nome, current_date - 20, current_date - 18, 'faturado', v_total, v_total, 0, v_cmv, o.id,
           'Semente DEMO: venda de material da obra ' || o.numero
     WHERE NOT EXISTS (SELECT 1 FROM public.erp_pedidos p WHERE p.company_id = v_c AND p.numero = 'DEMO-PV-' || o.numero);
  END LOOP;
END $$;

-- RD-98 p3: origem do dado das telas de resultado e cockpit (estavam 0/0)
UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_obra_resultado','v_obra_resultado_alocado','projetos_obras']::text[],
       rpcs_chamadas = ARRAY['fn_obras_receita']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/resultado';

UPDATE public.system_screens
   SET views_consumidas = ARRAY['v_obra_resultado_alocado','projetos_obras']::text[],
       rpcs_chamadas = ARRAY[]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/cockpit';
