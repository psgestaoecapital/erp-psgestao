-- Chamado #5933 · Code: rodrigo-code
--
-- BUG (parte 2): "Erro ao lançar produto sem a descrição do item na OS".
-- Na entrada de NF-e, ao vincular um produto a uma OS que NÃO tem aquela peça previamente
-- descrita (diagnóstico), o fluxo só sabia ligar a NF a uma peça JÁ digitada; sem peça livre,
-- o item caía num vínculo genérico silencioso e o produto nunca entrava como peça da OS.
-- (A parte 1 — vínculo PARCIAL da mesma peça comprada em 2 NF-e — já está na main.)
--
-- Esta migration adiciona a via que faltava: criar o produto da NF como NOVA peça da OS,
-- de forma ADITIVA e segura. Só vale para OS AINDA NÃO FATURADA (sem títulos gerados e sem
-- lançamento): adicionar peça a uma OS já faturada mudaria o escopo/valor do documento, então
-- nesse caso a função recusa com aviso para o operador tratar manualmente (mesmo princípio de
-- fn_os_item_ligar_produto_faturada, que só LIGA produto a peça existente de OS faturada).
--
-- Fail-closed: exige acesso do usuário à empresa da NF/OS; exige produto já vinculado no item
-- da NF; bloqueia OS cancelada/excluída/faturada. Não altera dado de cliente existente — só
-- INSERE uma linha nova de diagnóstico e carimba o vínculo no item da NF (mesmo rótulo
-- os:<os>:diag:<item> que a parte 1 usa para contabilizar o saldo parcial).

CREATE OR REPLACE FUNCTION public.fn_nfe_item_adicionar_peca_os(p_item_id uuid, p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD; v_os RECORD; v_prod RECORD; v_desc text; v_qtd numeric; v_ordem int; v_new_id uuid; v_vinc text;
BEGIN
  -- item da NF + empresa da nota
  SELECT i.*, n.company_id AS nfe_company
    INTO v_item
    FROM erp_nfe_recebidas_itens i
    JOIN erp_nfe_recebidas n ON n.id = i.nfe_recebida_id
   WHERE i.id = p_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item_nao_encontrado'); END IF;
  IF NOT (v_item.nfe_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- precisa do produto do estoque ligado ao item da NF (é o que vira a peça)
  IF v_item.produto_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vincule_produto_antes'); END IF;

  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id AND company_id = v_item.nfe_company;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'os_nao_encontrada'); END IF;

  IF v_os.status = 'cancelada' OR COALESCE(v_os.excluida, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'os_cancelada'); END IF;

  -- OS já faturada: não adiciona peça nova (mudaria o escopo/valor do documento) — trata manual.
  IF COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'os_faturada'); END IF;

  -- descrição: nome do produto do estoque; cai para a descrição do item da NF se faltar.
  SELECT nome, descricao INTO v_prod FROM erp_produtos WHERE id = v_item.produto_id;
  v_desc := COALESCE(NULLIF(btrim(v_prod.nome), ''), NULLIF(btrim(v_prod.descricao), ''), NULLIF(btrim(v_item.descricao), ''), 'Peça');
  v_qtd  := COALESCE(NULLIF(v_item.quantidade, 0), 1);

  SELECT COALESCE(max(ordem), 0) + 1 INTO v_ordem FROM erp_os_diagnostico_item WHERE os_id = p_os_id;

  INSERT INTO erp_os_diagnostico_item
    (company_id, os_id, tipo, produto_id, descricao, quantidade, severidade, custo_unitario, ordem)
  VALUES
    (v_item.nfe_company, p_os_id, 'peca', v_item.produto_id, v_desc, v_qtd, 'recomendado', v_item.valor_unitario, v_ordem)
  RETURNING id INTO v_new_id;

  -- carimba o vínculo no item da NF para a contagem de saldo parcial (parte 1) enxergar a peça.
  v_vinc := 'os:' || p_os_id::text || ':diag:' || v_new_id::text;
  UPDATE erp_nfe_recebidas_itens SET vinculo_origem = v_vinc WHERE id = p_item_id;

  RETURN jsonb_build_object('ok', true, 'diag_id', v_new_id, 'os_numero', v_os.numero,
                            'descricao', v_desc, 'quantidade', v_qtd, 'vinculo_origem', v_vinc);
END $function$;

REVOKE ALL ON FUNCTION public.fn_nfe_item_adicionar_peca_os(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_item_adicionar_peca_os(uuid, uuid) TO authenticated, service_role;

-- RD-95: "?" da ação "Adicionar como nova peça da OS"
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('nfe_recebida.os_adicionar_peca','/dashboard/compras/documentos-recebidos','Vínculo com OS',
   'Adicionar como nova peça da OS',
   'Use quando o produto da nota ainda NÃO está descrito como peça na Ordem de Serviço escolhida. O sistema cria a peça na OS já apontando para o produto do estoque, com a quantidade da nota.',
   'Evita ter que digitar a peça na OS antes de dar entrada na nota. Depois a saída de estoque e o faturamento da OS usam essa peça normalmente.',
   'Nota de compra de uma correia que a OS ainda não listava: um clique cria a peça "Correia" na OS com a quantidade comprada.',
   'A OS já está faturada? Então não dá para adicionar peça nova por aqui (mudaria o valor do documento) — ajuste a peça direto na OS. Ligue o produto ao item da nota antes de adicionar.',
   'ge', 70, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
