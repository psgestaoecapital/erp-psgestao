-- Hub · Simulador de Obra — PDCA aud8 (gaps 2 e 3): "ver a conta" do quantitativo.
-- O quantitativo já aplicava a perda e o custo unitário no cálculo, mas NÃO os devolvia:
-- a tela mostrava qtd/m², qtd total e custo, sem a perda% nem o custo unitário — o usuário
-- não conseguia conferir a conta (RD-98 DoD O.3.3 "ver a conta").
-- Esta migration é ADITIVA: só acrescenta 'perda_pct' e 'custo_unitario' a cada item do
-- quantitativo (nenhuma chave existente muda; o cálculo de qtd_total/custo_total é idêntico).
-- Não toca dado de cliente. SECURITY DEFINER + guarda por empresa preservados.

CREATE OR REPLACE FUNCTION public.fn_simular_montagem(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid DEFAULT NULL::uuid, p_area numeric DEFAULT 1
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_preco jsonb; v_quant jsonb; v_nome text; v_unidade text; v_area numeric;
BEGIN
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro','sem_acesso'); END IF;
  v_area := GREATEST(COALESCE(p_area,0), 0);

  SELECT nome, unidade INTO v_nome, v_unidade FROM projetos_servicos WHERE id=p_servico_id;

  v_preco := fn_precificar_montagem(p_servico_id, p_company_id, p_business_line_id);
  IF (v_preco->>'ok')::bool IS NOT TRUE THEN RETURN v_preco; END IF;

  SELECT jsonb_agg(jsonb_build_object(
     'insumo', i.name, 'unidade', b.unidade,
     'qtd_m2', b.quantidade,
     'perda_pct', COALESCE(b.perda_pct,0),
     'custo_unitario', COALESCE(i.current_cost,0),
     'qtd_total', round(b.quantidade * (1+COALESCE(b.perda_pct,0)/100.0) * v_area, 3),
     'custo_total', round(b.quantidade*(1+COALESCE(b.perda_pct,0)/100.0)*COALESCE(i.current_cost,0)*v_area,2)
   ) ORDER BY b.ordem)
  INTO v_quant
  FROM projetos_servicos_bom b JOIN m16_insumos i ON i.id=b.insumo_id
  WHERE b.servico_id=p_servico_id AND b.tipo='insumo';

  RETURN jsonb_build_object('ok', true,
    'montagem', v_nome, 'unidade', v_unidade, 'area', v_area,
    'preco_m2', v_preco,
    'total_obra', round(COALESCE((v_preco->>'total_m2')::numeric,0) * v_area, 2),
    'quantitativo', COALESCE(v_quant,'[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.fn_simular_montagem(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_simular_montagem(uuid, uuid, uuid, numeric) TO authenticated, service_role;

-- RD-95: "?" dos campos novos do quantitativo (perda, custo unitário) e da ação Exportar.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub', 'publicado'
FROM (VALUES
 ('projetos.simulador.perda', 'Resultado', 'Perda',
  'Não preenche: vem da composição da montagem (quanto de material se perde no corte/aplicação).',
  'Mostra a perda aplicada em cada insumo. A quantidade total já soma essa perda sobre a quantidade por metro — é a conta que explica por que a quantidade total é maior que o coeficiente × metragem.',
  'Coeficiente 1,2 un/m², perda 10%, 100 m²: quantidade total = 1,2 × 1,10 × 100 = 132 un.',
  'Achar que a perda é cobrada à parte: ela já está embutida na quantidade total e no custo de cada insumo.',
  986, '/dashboard/projetos/simulador'),
 ('projetos.simulador.custo_unitario', 'Resultado', 'Custo unitário',
  'Não preenche: é o custo atual do insumo no cadastro de produtos.',
  'É o preço de uma unidade do insumo. O custo da linha é a quantidade total × este custo unitário — assim dá para conferir cada valor do quantitativo.',
  'Custo unitário R$ 12,50 e quantidade total 132 un: custo da linha = R$ 1.650,00.',
  'Comparar com uma nota antiga: o custo é o do cadastro hoje; atualize o custo do insumo para o orçamento refletir o preço atual.',
  987, '/dashboard/projetos/simulador'),
 ('projetos.simulador.exportar', 'Resultado', 'Exportar lista de materiais',
  'Clique para baixar a lista de compra em Excel ou enviar por WhatsApp.',
  'Leva o quantitativo (insumo, quantidade total e custo) e os totais para fora do sistema — para cotar com fornecedor, montar a lista de compra ou mandar para a obra.',
  'Baixar a planilha com os 8 insumos da montagem e os totais para cotação; ou abrir o WhatsApp já com a lista pronta.',
  'Esperar que exportar gere pedido de compra: aqui só sai a lista; a compra é feita no módulo de compras.',
  988, '/dashboard/projetos/simulador')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
