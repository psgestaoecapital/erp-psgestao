-- Chamado #20 · Fase 1: "Gerar financeiro" reusa o form de receita (§2.4).
--
-- Hoje o botão "Gravar Financeiro" chama fn_os_faturar, que cria um título PELADO (sem forma de
-- pagamento nem parcelas). A Jordana pediu abrir "uma cópia da tela de lançamento de receitas onde
-- possamos conferir a forma de pagamento, parcelas, etc". Então: a tela abre o form de receita
-- pré-preenchido (cliente, valor, descrição da OS); o form cria o erp_receber (com parcelas/forma);
-- e ESTA função VINCULA esse receber à OS e faz o resto que a fn_os_faturar fazia ALÉM do título —
-- baixa de estoque das peças de NF vinculadas + snapshot custo/lucro. RD-26: mesma mecânica, sem
-- duplicar o título.
--
-- Escopo Fase 1: caminho AVULSO (oficina). OS ligada a pedido continua no fluxo do pedido (fn_faturar).

CREATE OR REPLACE FUNCTION public.fn_os_vincular_financeiro(p_os_id uuid, p_receber_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os record; v_local uuid; r record; v_baixados int := 0; v_receber_ok boolean;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;
  IF coalesce(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta OS já foi faturada.', 'ja_faturada', true); END IF;
  IF v_os.status NOT IN ('entregue','pronta','concluida','concluída','finalizada') THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Só OS pronta/entregue pode ser faturada (situação atual: ' || coalesce(v_os.status,'?') || ').'); END IF;

  -- o receber tem que existir e ser da MESMA empresa (o form acabou de criar)
  SELECT EXISTS(SELECT 1 FROM erp_receber WHERE id = p_receber_id AND company_id = v_os.company_id) INTO v_receber_ok;
  IF NOT v_receber_ok THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento financeiro não encontrado.'); END IF;

  -- amarra o receber a esta OS (rastreabilidade) sem sobrescrever um vínculo já existente
  UPDATE erp_receber SET ref_externa_id = v_os.id::text, ref_externa_sistema = 'oficina_os'
    WHERE id = p_receber_id AND (ref_externa_id IS NULL OR btrim(ref_externa_id) = '');
  UPDATE erp_os SET titulos_gerados = true, lancamento_id = p_receber_id, updated_at = now() WHERE id = p_os_id;

  -- baixa de estoque (idêntico ao fn_os_faturar): peças de NF vinculadas a ESTA OS saem do estoque
  v_local := public.fn_estoque_local_principal(v_os.company_id);
  IF v_local IS NOT NULL THEN
    FOR r IN
      SELECT ni.produto_id, ni.quantidade, ni.valor_unitario
        FROM erp_nfe_recebidas_itens ni
       WHERE ni.company_id = v_os.company_id AND ni.produto_id IS NOT NULL
         AND COALESCE(ni.estoque_movimentado, false) = true
         AND ni.vinculo_origem LIKE ('os:' || p_os_id::text || '%')
         AND EXISTS (SELECT 1 FROM erp_produtos p WHERE p.id = ni.produto_id AND p.company_id = v_os.company_id)
    LOOP
      PERFORM public.fn_movimentar_estoque(
        p_produto_id := r.produto_id, p_local_id := v_local, p_tipo := 'saida',
        p_quantidade := r.quantidade, p_custo_unitario := COALESCE(r.valor_unitario, 0),
        p_motivo := 'Consumo em OS faturada', p_observacoes := 'OS ' || COALESCE(v_os.numero, ''),
        p_ref_tipo := 'os', p_ref_id := p_os_id, p_ref_numero := v_os.numero);
      v_baixados := v_baixados + 1;
    END LOOP;
  END IF;

  -- agora que há título (receita), recalcula o painel custo/lucro
  PERFORM public.fn_os_snapshot_custo_lucro(p_os_id, false);

  RETURN jsonb_build_object('ok', true, 'via', 'receita_form', 'os_numero', v_os.numero,
    'receber_id', p_receber_id, 'lancamento_id', p_receber_id, 'itens_estoque_baixados', v_baixados);
END $function$;
