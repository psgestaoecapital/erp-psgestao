-- Oficina · ponte diagnóstico → cotação de compra (RD-26 · pedido KGF)
--
-- O mecânico faz o diagnóstico (erp_os_diagnostico_item); o administrativo gera uma cotação a partir
-- dele SEM redigitar, escolhendo quais itens cotar (exclui serviço e o que já tem em estoque). A cotação
-- cai direto na tela de comparação de fornecedores QUE JÁ EXISTE (erp_cotacoes + _itens + _fornecedores
-- + _propostas). Compras/cotação/estoque são monopólio da GE [→GE]; a Oficina só dispara o evento e
-- consome o resultado — não recria janela de compras.
--
-- Aqui: (1) vínculo cotação↔OS (coluna os_id, aditiva) e (2) a RPC que cria a cotação a partir do
-- diagnóstico, herdando produto_id/descrição/quantidade — nada de digitação nova.

-- Vínculo cotação → OS (para o retorno dos preços atualizar a OS depois · Part 3). Aditivo, nullable.
ALTER TABLE public.erp_cotacoes ADD COLUMN IF NOT EXISTS os_id uuid REFERENCES public.erp_os(id);
CREATE INDEX IF NOT EXISTS idx_erp_cotacoes_os_id ON public.erp_cotacoes(os_id) WHERE os_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_os_diagnostico_gerar_cotacao(
  p_os_id     uuid,
  p_itens_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_os        RECORD;
  v_cotacao_id uuid;
  v_numero     text;
  v_qtd        int := 0;
  v_uid        uuid := auth.uid();
BEGIN
  SELECT * INTO v_os FROM public.erp_os WHERE id = p_os_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'os_nao_encontrada');
  END IF;
  -- guard multi-tenant (Pilar 2)
  IF NOT (v_os.company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  IF p_itens_ids IS NULL OR cardinality(p_itens_ids) = 0 THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_itens',
      'msg', 'Selecione ao menos um item de produto para cotar.');
  END IF;

  v_numero := public.next_cotacao_numero(v_os.company_id);

  INSERT INTO public.erp_cotacoes (company_id, numero, descricao, status, data_abertura, solicitante, created_by, os_id)
  VALUES (
    v_os.company_id, v_numero,
    left('OS ' || COALESCE(v_os.numero, '') || COALESCE(' — ' || NULLIF(v_os.cliente_nome, ''), ''), 200),
    'rascunho', CURRENT_DATE, 'Oficina', v_uid, p_os_id
  )
  RETURNING id INTO v_cotacao_id;

  -- Só PEÇAS entre os selecionados (defensivo: serviço/mão de obra NUNCA é cotado, mesmo se vier no array).
  -- ATENÇÃO: o tipo real em erp_os_diagnostico_item é 'peca'/'servico' (auditado), NÃO 'produto' como diz o SPEC.
  -- Herda produto_id/descrição/quantidade do diagnóstico; nome/código/unidade do cadastro quando houver.
  INSERT INTO public.erp_cotacoes_itens
    (cotacao_id, company_id, ordem, produto_id, produto_codigo, produto_nome, produto_descricao, unidade, quantidade)
  SELECT
    v_cotacao_id, v_os.company_id,
    row_number() OVER (ORDER BY di.ordem NULLS LAST, di.created_at),
    di.produto_id,
    left(pe.codigo, 30),
    left(COALESCE(pe.nome, di.descricao, 'Item'), 200),
    di.descricao,
    left(COALESCE(pe.unidade, 'UN'), 10),
    COALESCE(NULLIF(di.quantidade, 0), 1)
  FROM public.erp_os_diagnostico_item di
  LEFT JOIN public.v_erp_produtos_estoque pe ON pe.id = di.produto_id
  WHERE di.os_id = p_os_id
    AND di.company_id = v_os.company_id
    AND di.id = ANY(p_itens_ids)
    AND di.tipo = 'peca';
  GET DIAGNOSTICS v_qtd = ROW_COUNT;

  IF v_qtd = 0 THEN
    DELETE FROM public.erp_cotacoes WHERE id = v_cotacao_id;   -- nada de peça pra cotar → desfaz
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_pecas',
      'msg', 'Nenhuma peça entre os itens selecionados (serviços/mão de obra não entram em cotação).');
  END IF;

  RETURN jsonb_build_object('sucesso', true, 'cotacao_id', v_cotacao_id, 'numero', v_numero, 'itens', v_qtd);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_diagnostico_gerar_cotacao(uuid, uuid[]) TO authenticated;
