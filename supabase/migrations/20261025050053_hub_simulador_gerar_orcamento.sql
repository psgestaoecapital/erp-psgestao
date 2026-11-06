-- Hub comercial · Simulador → Orçamento (caixa b8921ddd, desenvolvedor_5_g).
-- Função NOVA (aditiva): refaz a simulação no servidor (não confia em valor vindo da tela) e grava um orçamento em
-- rascunho com 1 item de serviço (qtd = metragem, preço = total/unidade). Opcional: cliente e oportunidade.
CREATE OR REPLACE FUNCTION public.fn_simulador_gerar_orcamento(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid, p_area numeric,
  p_cliente_id uuid DEFAULT NULL, p_oportunidade_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sim jsonb; v_orc uuid; v_numero text; v_cli text; v_unid text; v_total numeric; v_validade int; v_vend text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_login'); END IF;
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(p_area, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'metragem_invalida'); END IF;
  v_sim := fn_simular_montagem(p_servico_id, p_company_id, p_business_line_id, p_area);
  IF NOT COALESCE((v_sim->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_sim->>'erro', 'falha_simulacao'));
  END IF;
  v_total := COALESCE((v_sim->'preco_m2'->>'total_m2')::numeric, 0);
  IF v_total <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_preco'); END IF;
  v_unid := COALESCE(NULLIF(v_sim->>'unidade', ''), 'm²');
  IF p_cliente_id IS NOT NULL THEN
    SELECT COALESCE(nome_fantasia, razao_social) INTO v_cli FROM erp_clientes WHERE id = p_cliente_id AND company_id = p_company_id;
    IF v_cli IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'cliente_invalido'); END IF;
  END IF;
  IF p_oportunidade_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM erp_crm_oportunidade WHERE id = p_oportunidade_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'oportunidade_invalida');
  END IF;
  SELECT COALESCE(validade_proposta_dias, 30) INTO v_validade FROM projetos_modulo_config WHERE company_id = p_company_id;
  v_validade := COALESCE(v_validade, 30);
  SELECT COALESCE(raw_user_meta_data->>'full_name', email) INTO v_vend FROM auth.users WHERE id = auth.uid();
  INSERT INTO erp_orcamentos (company_id, cliente_id, cliente_nome, status, data_emissao, data_validade,
    vendedor_id, vendedor_nome, observacoes_internas, created_by)
  VALUES (p_company_id, p_cliente_id, v_cli, 'rascunho', CURRENT_DATE, CURRENT_DATE + v_validade,
    auth.uid(), v_vend, 'Gerado do Simulador: ' || COALESCE(v_sim->>'montagem', ''), auth.uid())
  RETURNING id, numero INTO v_orc, v_numero;
  INSERT INTO erp_orcamentos_itens (orcamento_id, company_id, ordem, unidade, quantidade, preco_unitario,
    desconto_percentual, desconto_valor, subtotal, tipo_item, servico_id, servico_descricao, produto_nome)
  VALUES (v_orc, p_company_id, 0, v_unid, p_area, v_total, 0, 0, round(p_area * v_total, 2), 'servico',
    p_servico_id, COALESCE(v_sim->>'montagem', 'Montagem'), COALESCE(v_sim->>'montagem', 'Montagem'));
  IF p_oportunidade_id IS NOT NULL THEN
    UPDATE erp_crm_oportunidade SET orcamento_id = v_orc, updated_at = now()
     WHERE id = p_oportunidade_id AND orcamento_id IS NULL;
  END IF;
  RETURN jsonb_build_object('ok', true, 'orcamento_id', v_orc, 'numero', v_numero, 'total', round(p_area * v_total, 2));
END $$;
REVOKE ALL ON FUNCTION public.fn_simulador_gerar_orcamento(uuid, uuid, uuid, numeric, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_simulador_gerar_orcamento(uuid, uuid, uuid, numeric, uuid, uuid) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Simulador', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/simulador', 'projetos', 'publicado'
FROM (VALUES
 ('projetos.simulador.cliente', 'Cliente do orçamento', 'Opcional. Escolha o cliente para quem o orçamento será gerado; sem cliente, ele nasce em rascunho e você completa depois.', 'Liga o orçamento ao cliente certo desde o início, para a proposta seguir no funil visita → proposta → venda.', 'Construtora Alfa, para a obra de 100 m² simulada.', 'Gerar sem cliente e esquecer de completar: o rascunho não aparece na ficha do cliente.', 40),
 ('projetos.simulador.gerar_orcamento', 'Gerar orçamento', 'Clique para criar o orçamento em rascunho com esta montagem, a metragem e o preço por unidade calculados aqui.', 'Transforma a simulação em orçamento sem digitar de novo. O valor é recalculado no servidor na hora de gerar.', 'Montagem de drywall, 100 m², total de R$ 12.300,00 vira o orçamento ORC-… em rascunho.', 'Achar que o orçamento já foi enviado ao cliente: ele nasce em rascunho e precisa ser revisado e enviado.', 50),
 ('projetos.simulador.total_obra', 'Total da obra', 'Não se preenche: é o resultado (total por unidade × metragem).', 'É o valor que vai para o orçamento ao gerar.', '100 m² × R$ 123,00 = R$ 12.300,00.', 'Esquecer de conferir a metragem antes de gerar o orçamento.', 60),
 ('projetos.simulador.orcamento_unidade', 'Orçamento por unidade', 'Não se preenche: mostra material, mão de obra, comissão e custo fixo por unidade, e a margem.', 'Mostra de onde vem o preço, camada a camada, e quanto sobra de margem.', 'Material R$ 60 + mão de obra R$ 40 + comissão + custo fixo = total por m².', 'Ler a margem como lucro líquido: ela já considera as camadas mostradas, não impostos da nota.', 70)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
