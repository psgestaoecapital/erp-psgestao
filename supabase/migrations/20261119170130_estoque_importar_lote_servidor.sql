-- #9667 / #8621(B) · Importação de estoque por planilha EM LOTE no servidor.
-- Hoje a tela grava UM item por vez pelo navegador (fn_erp_produto_salvar + ajuste de saldo,
-- ~1 item/2s), o que depende da aba ficar em foco e trava migrações grandes (ex.: cliente 163,
-- 12.125 itens, parado em 572). Esta função ADITIVA faz o MESMO trabalho por item, mas em um
-- lote (uma chamada só por bloco), de forma resiliente ao foco da aba e IDEMPOTENTE:
--   • fn_erp_produto_salvar faz upsert por código (reimportar não duplica);
--   • fn_estoque_ajuste_migracao só movimenta quando o saldo difere (reimportar igual = 0 mov.).
-- Toda a leitura/parse do xlsx (locale, #8621) continua no cliente; aqui só gravamos.
--
-- Segurança: SECURITY DEFINER com guarda por empresa (get_user_company_ids/is_admin); REVOKE anon;
-- GRANT só authenticated. As funções internas re-conferem a empresa por produto (defesa em
-- profundidade). RD-52: o cliente envia blocos pequenos (≤ v_max); cada chamada é uma transação
-- curta e retomável — não varre tabela grande nem chama função por linha em volume ilimitado.
--
-- RD-38 (provado em produção, BEGIN..ROLLBACK, empresa DEMO Comércio GE, usuário real):
--   passada 1: upsert=2 comSaldo=2 semMudanca=0  → 2 produtos, 2 movimentos
--   passada 2 (reimport igual): upsert=2 comSaldo=0 semMudanca=2 → 0 duplicata, 0 movimento novo
--   produtos=2 (não 4), movimentos=2 (não 4); saldo A=0.900, B=-3.000 (negativo aceito), custo A=28.56.

CREATE OR REPLACE FUNCTION public.fn_estoque_importar_lote(
  p_company_id uuid,
  p_itens      jsonb,
  p_motivo     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max      int := 1000;   -- teto por chamada (RD-52: transação curta); o cliente envia ~300
  v_motivo   text := COALESCE(NULLIF(btrim(p_motivo), ''), 'Migração de estoque · planilha padrão PS');
  v_item     jsonb;
  v_dados    jsonb;
  v_ex       jsonb;
  r          jsonb;
  raj        jsonb;
  v_pid      uuid;
  v_linha    int;
  v_codigo   text;
  v_criados  int := 0;
  v_comsaldo int := 0;
  v_semmud   int := 0;
  v_erros    jsonb := '[]'::jsonb;
BEGIN
  -- guarda de empresa (mesmo critério das funções de estoque/cadastro)
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'itens_invalidos');
  END IF;

  IF jsonb_array_length(p_itens) > v_max THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'lote_grande_demais',
                              'max', v_max, 'recebido', jsonb_array_length(p_itens));
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    v_linha  := NULLIF(v_item->>'linha','')::int;
    v_dados  := v_item->'dados';
    v_codigo := COALESCE(v_dados->>'codigo', v_item->>'codigo', '');

    -- 1) produto (upsert por código, validação legal SPED 0200 na própria função)
    r := fn_erp_produto_salvar(p_company_id, v_dados);
    IF NOT COALESCE((r->>'ok')::boolean, false) OR (r->>'id') IS NULL THEN
      v_erros := v_erros || jsonb_build_object(
        'linha', v_linha, 'codigo', v_codigo,
        'motivo', COALESCE(r->>'erro','falha ao salvar')
          || CASE WHEN r ? 'campos' THEN ' ('||array_to_string(ARRAY(SELECT jsonb_array_elements_text(r->'campos')), ', ')||')' ELSE '' END);
      CONTINUE;
    END IF;
    v_pid := (r->>'id')::uuid;
    v_criados := v_criados + 1;

    -- 2) colunas descritivas + custo médio (só sobrescreve o que veio informado)
    v_ex := v_item->'extras';
    IF v_ex IS NOT NULL AND v_ex <> '{}'::jsonb THEN
      UPDATE erp_produtos SET
        preco_custo_medio      = COALESCE((v_ex->>'preco_custo_medio')::numeric, preco_custo_medio),
        custo_medio_origem     = COALESCE(v_ex->>'custo_medio_origem', custo_medio_origem),
        estoque_minimo         = COALESCE((v_ex->>'estoque_minimo')::numeric, estoque_minimo),
        categoria              = COALESCE(v_ex->>'categoria', categoria),
        marca                  = COALESCE(v_ex->>'marca', marca),
        fornecedor_padrao_nome = COALESCE(v_ex->>'fornecedor_padrao_nome', fornecedor_padrao_nome),
        localizacao            = COALESCE(v_ex->>'localizacao', localizacao),
        codigo_barras          = COALESCE(v_ex->>'codigo_barras', codigo_barras),
        updated_at             = now()
      WHERE id = v_pid AND company_id = p_company_id;
    END IF;

    -- 3) saldo por AJUSTE (idempotente; aceita negativo; 0 movimentações se já bate)
    raj := fn_estoque_ajuste_migracao(
      v_pid,
      COALESCE((v_item->>'saldo')::numeric, 0),
      COALESCE((v_item->>'custo')::numeric, 0),
      v_motivo);
    IF NOT COALESCE((raj->>'ok')::boolean, false) THEN
      v_erros := v_erros || jsonb_build_object('linha', v_linha, 'codigo', v_codigo,
        'motivo', 'produto ok, saldo falhou: '||COALESCE(raj->>'erro','erro'));
    ELSIF COALESCE((raj->>'ajustado')::boolean, false) THEN
      v_comsaldo := v_comsaldo + 1;
    ELSE
      v_semmud := v_semmud + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'total', jsonb_array_length(p_itens),
    'criados', v_criados,
    'com_saldo', v_comsaldo,
    'sem_mudanca', v_semmud,
    'erros', v_erros);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_estoque_importar_lote(uuid, jsonb, text) FROM public;
REVOKE ALL ON FUNCTION public.fn_estoque_importar_lote(uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_estoque_importar_lote(uuid, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.fn_estoque_importar_lote(uuid, jsonb, text) IS
  '#9667 · Importa estoque por planilha EM LOTE (servidor), resiliente ao foco da aba e idempotente. Envolve fn_erp_produto_salvar + fn_estoque_ajuste_migracao por item. Guarda por empresa; REVOKE anon.';
