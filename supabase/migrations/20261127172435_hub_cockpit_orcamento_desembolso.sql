-- 20261127013035 · code-desenvolvedor-3 · PDCA Cockpit da obra (tela 329, msg 71a86c52)
-- Blueprint hub_projetos 329, requisito cbde929d (essencial, parcial): o cockpit precisa do breakdown
-- financeiro "valor ORÇADO, CONTRATADO, PAGO e PENDENTE; saldo e projeção do custo".
--
-- ADITIVA e SÓ LEITURA: uma função nova fn_obra_cockpit_orcamento(p_obra_id) + 6 chaves de ajuda (RD-95).
-- Nenhuma tabela/coluna de cliente é alterada; nada é escrito.
--
-- RD-38 (provado no dado, DEMO Construtora b0700000-…-006, read-only):
--   • Orçado    = Σ (quantidade_contratada × custo_unitario_previsto) dos itens do orçamento aprovado da obra
--                 (mesma fonte do custo_previsto da v_obra_resultado) — ex.: DEMO-FC-001 = 304.465,60.
--   • Contratado= Σ valor dos títulos a pagar da obra (erp_pagar ligado pelo CENTRO DE CUSTO da obra, não
--                 cancelado, não deletado, fora de viagem) — MESMO vínculo da v_obra_resultado_alocado
--                 (coluna custo_contas_pagar). É o comprometido em contas a pagar, não o pago.
--   • Pago      = Σ valor_pago desses mesmos títulos (a parte já baixada).
--   • Pendente  = Contratado − Pago (o que falta liquidar).
-- Saldo e projeção do custo são derivados na tela (orçado − custo realizado; custo realizado ÷ avanço físico),
-- a partir de números que o cockpit já tem (v_obra_resultado_alocado + pct_conclusao), para não duplicar fonte.
--
-- Isolamento: SECURITY DEFINER + fn__guarda_empresa(company da obra); REVOKE anon; nenhuma escrita.

CREATE OR REPLACE FUNCTION public.fn_obra_cockpit_orcamento(p_obra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_cc uuid;
  v_orcado numeric := 0;
  v_contratado numeric := 0;
  v_pago numeric := 0;
BEGIN
  IF p_obra_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'obra_nao_informada');
  END IF;

  SELECT company_id, centro_custo_id INTO v_company, v_cc
    FROM public.projetos_obras WHERE id = p_obra_id;

  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'obra_nao_encontrada');
  END IF;

  -- Só a empresa dona lê os números da obra (isolamento por empresa).
  PERFORM public.fn__guarda_empresa(v_company);

  -- Orçado: custo previsto no orçamento aprovado da obra (itens vivos).
  SELECT COALESCE(sum(i.quantidade_contratada * COALESCE(i.custo_unitario_previsto, 0)), 0)
    INTO v_orcado
    FROM public.projetos_obra_item i
   WHERE i.obra_id = p_obra_id AND i.excluido_em IS NULL;

  -- Contratado/Pago: títulos a pagar da obra pelo centro de custo (mesma regra da v_obra_resultado_alocado).
  -- Sem centro de custo na obra (v_cc NULL) não há vínculo e ambos ficam zero.
  IF v_cc IS NOT NULL THEN
    SELECT COALESCE(sum(p.valor), 0), COALESCE(sum(COALESCE(p.valor_pago, 0)), 0)
      INTO v_contratado, v_pago
      FROM public.erp_pagar p
     WHERE p.company_id = v_company
       AND p.centro_custo_id = v_cc
       AND p.deleted_at IS NULL
       AND p.status::text <> 'cancelado'
       AND p.ref_externa_sistema IS DISTINCT FROM 'viagem';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'orcado', round(v_orcado, 2),
    'contratado', round(v_contratado, 2),
    'pago', round(v_pago, 2),
    'pendente', round(v_contratado - v_pago, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_obra_cockpit_orcamento(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_obra_cockpit_orcamento(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_cockpit_orcamento(uuid) TO authenticated;

-- RD-95: "?" em cada indicador novo do cockpit (família vertical=null, ordem 910+ da tela 329).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.cockpit.orcado', '/dashboard/projetos/obras/[id]/cockpit', 'Orçamento × desembolso', 'Orçado',
   'Nada a preencher: é o custo previsto no orçamento aprovado da obra (soma de quantidade × custo unitário previsto dos itens).',
   'Mostra quanto a obra planejou gastar. É a base do saldo e da projeção.',
   'Orçamento de R$ 304.465,60 em itens.', 'Zerado quando a obra ainda não tem orçamento cadastrado — cadastre o orçamento (EAP).',
   NULL, 915, 1, 'publicado'),
  ('projetos.cockpit.contratado', '/dashboard/projetos/obras/[id]/cockpit', 'Orçamento × desembolso', 'Contratado',
   'Nada a preencher: é o total dos títulos a pagar da obra (contratos, compras e serviços lançados no centro de custo da obra).',
   'Mostra quanto já foi comprometido em contas a pagar — o que a obra se obrigou a pagar.',
   'R$ 120.000 em títulos a pagar da obra.', 'Zerado quando ainda não há título a pagar ligado ao centro de custo da obra.',
   NULL, 916, 1, 'publicado'),
  ('projetos.cockpit.pago', '/dashboard/projetos/obras/[id]/cockpit', 'Orçamento × desembolso', 'Pago',
   'Nada a preencher: é a parte do contratado que já foi baixada (valor pago dos títulos a pagar da obra).',
   'Mostra quanto do comprometido já saiu do caixa.',
   'R$ 80.000 pagos de R$ 120.000 contratados.', 'Fica zerado enquanto nenhum título a pagar da obra tiver baixa.',
   NULL, 917, 1, 'publicado'),
  ('projetos.cockpit.pendente', '/dashboard/projetos/obras/[id]/cockpit', 'Orçamento × desembolso', 'Pendente',
   'Nada a preencher: é o que falta pagar do contratado (contratado menos pago).',
   'Mostra quanto ainda vai desembolsar dos compromissos já assumidos.',
   'R$ 40.000 a liquidar.', 'Zerado quando não há título a pagar ou tudo já foi pago.',
   NULL, 918, 1, 'publicado'),
  ('projetos.cockpit.saldo_orcado', '/dashboard/projetos/obras/[id]/cockpit', 'Orçamento × desembolso', 'Saldo do orçado',
   'Nada a preencher: é o orçado menos o custo já realizado da obra.',
   'Mostra quanto ainda cabe no orçamento. Vermelho = o custo realizado já passou do orçado.',
   'Orçado 304.465,60 − realizado 188.939,09 = saldo 115.526,51.', 'Precisa do orçamento cadastrado; sem ele não dá para calcular o saldo.',
   NULL, 919, 1, 'publicado'),
  ('projetos.cockpit.projecao_custo', '/dashboard/projetos/obras/[id]/cockpit', 'Orçamento × desembolso', 'Projeção do custo',
   'Nada a preencher: é a estimativa do custo total ao final = custo realizado ÷ avanço físico.',
   'Mostra para quanto o custo tende a ir no ritmo atual. Vermelho = projeção acima do orçado.',
   'Realizado 188.939 a 56% físico → projeção ≈ 337.391.', 'Precisa de custo lançado e avanço físico (% de conclusão) para projetar.',
   NULL, 920, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, versao = EXCLUDED.versao, status = EXCLUDED.status;
