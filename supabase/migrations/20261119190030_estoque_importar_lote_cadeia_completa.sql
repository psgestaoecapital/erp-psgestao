-- Importador de estoque server-side — chamado #9667 (CEO/Eng. Chefe · RD-41). REVISA a fn_estoque_importar_lote
-- (#5370): troca o INSERT magro pela CADEIA COMPLETA (RD-26), para o front poder ligar nela SEM regressão.
--
-- Causa (RD-38): a tela importar/page.tsx grava item-a-item no navegador (2 RPCs/linha × 12.125 = horas, trava se
-- a aba perde foco). A #5370 existia mas nunca foi chamada; e como fazia INSERT direto (só codigo/nome/unidade/
-- ncm/preço), ligar o front nela perderia o SPED 0200 e ~10 campos (custo médio, estoque mínimo, categoria, marca,
-- fornecedor, localização, cód. barras, cest, origem, tipo_item) para TODA empresa. Esta versão reaproveita a
-- mesma cadeia que a tela já usa: fn_erp_produto_salvar (upsert + SPED) + UPDATE dos descritivos +
-- fn_estoque_ajuste_migracao (saldo ABSOLUTO, idempotente). Provado em BEGIN..ROLLBACK (produção, sob JWT de
-- usuário DEMO): produto criado com todos os campos, estoque_atual=7 por 1 movimentação, re-ajuste do mesmo saldo
-- = ajustado=false (idempotente).
--
-- Contrato de cada linha de p_rows (o front monta exatamente isto): codigo, nome, unidade, tipo_item_sped, origem,
-- ncm, cest, preco_venda, preco_custo_medio (= custo médio, vira também o custo do ajuste), estoque_minimo,
-- categoria, marca, fornecedor_padrao_nome, localizacao, codigo_barras, estoque_atual (saldo alvo), n (nº da linha).
-- dry_run=true (default) só CLASSIFICA (novo × atualizado × erro), sem gravar. Erro de linha é reportado, não aborta.
-- O log em erp_importacoes fica no FRONT (1 linha por importação, atravessando os chunks) — a função é pura e
-- chunkável sem duplicar histórico. Multi-tenant fail-closed (a própria cadeia reforça por empresa).

CREATE OR REPLACE FUNCTION public.fn_estoque_importar_lote(
  p_company_id uuid, p_rows jsonb, p_dry_run boolean DEFAULT true,
  p_user_id uuid DEFAULT NULL::uuid, p_arquivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb; v_raw text;
  v_codigo text; v_nome text; v_unidade text; v_tipo text; v_ncm text; v_origem text; v_cest text;
  v_preco_venda numeric; v_custo numeric; v_estoque_min numeric; v_saldo numeric;
  v_categoria text; v_marca text; v_fornecedor text; v_local text; v_barras text;
  v_dados jsonb; v_res jsonb; v_aj jsonb; v_pid uuid; v_existe boolean; v_falta text; v_motivo text;
  v_total int:=0; v_novos int:=0; v_atualizados int:=0; v_saldos int:=0; v_sem int:=0; v_erros int:=0;
  v_erros_detalhe jsonb := '[]'::jsonb; v_n int; v_valor numeric := 0;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  -- Guarda multi-tenant (padrão da cadeia): serviço/cron, admin, ou usuário com acesso à empresa.
  IF NOT (v_interno OR is_admin() OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id obrigatorio'); END IF;
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'rows vazias'); END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_total := v_total + 1;
    v_n       := COALESCE((v_row->>'n')::int, v_total);
    v_codigo  := NULLIF(btrim(COALESCE(v_row->>'codigo','')), '');
    v_nome    := NULLIF(btrim(COALESCE(v_row->>'nome','')), '');
    v_unidade := NULLIF(btrim(COALESCE(v_row->>'unidade','')), '');
    v_tipo    := NULLIF(btrim(COALESCE(v_row->>'tipo_item_sped','')), '');
    v_ncm     := NULLIF(regexp_replace(COALESCE(v_row->>'ncm',''), '\D', '', 'g'), '');
    v_origem  := NULLIF(btrim(COALESCE(v_row->>'origem','')), '');
    v_cest    := NULLIF(btrim(COALESCE(v_row->>'cest','')), '');
    v_categoria  := NULLIF(btrim(COALESCE(v_row->>'categoria','')), '');
    v_marca      := NULLIF(btrim(COALESCE(v_row->>'marca','')), '');
    v_fornecedor := NULLIF(btrim(COALESCE(v_row->>'fornecedor_padrao_nome','')), '');
    v_local      := NULLIF(btrim(COALESCE(v_row->>'localizacao','')), '');
    v_barras     := NULLIF(btrim(COALESCE(v_row->>'codigo_barras','')), '');
    -- números tolerantes a vírgula (o front já canoniza, mas a função não confia)
    v_preco_venda := NULL; v_custo := NULL; v_estoque_min := NULL; v_saldo := NULL;
    v_raw := btrim(COALESCE(v_row->>'preco_venda',''));        IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_preco_venda := replace(v_raw, ',', '.')::numeric; END IF;
    v_raw := btrim(COALESCE(v_row->>'preco_custo_medio',''));  IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_custo       := replace(v_raw, ',', '.')::numeric; END IF;
    v_raw := btrim(COALESCE(v_row->>'estoque_minimo',''));     IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_estoque_min := replace(v_raw, ',', '.')::numeric; END IF;
    v_raw := btrim(COALESCE(v_row->>'estoque_atual',''));      IF v_raw ~ '^-?[0-9]+([.,][0-9]+)?$' THEN v_saldo       := replace(v_raw, ',', '.')::numeric; END IF;

    -- Validação legal (ESPELHA fn_erp_produto_salvar · SPED 0200). Linha inválida = erro reportado, NÃO aborta o lote.
    v_falta := concat_ws(', ',
      CASE WHEN v_codigo  IS NULL THEN 'codigo' END,
      CASE WHEN v_nome    IS NULL THEN 'nome' END,
      CASE WHEN v_unidade IS NULL THEN 'unidade' END,
      CASE WHEN v_tipo    IS NULL THEN 'tipo_item_sped' END,
      CASE WHEN v_tipo IS NOT NULL AND v_tipo NOT IN ('00','01','02','03','04','05','06','07','08','09','10','99') THEN 'tipo_item_sped_invalido' END,
      CASE WHEN v_tipo IN ('00','01','02','03','04','05','06') AND v_ncm IS NULL THEN 'ncm' END);
    IF v_falta <> '' THEN
      v_erros := v_erros + 1;
      IF jsonb_array_length(v_erros_detalhe) < 200 THEN
        v_erros_detalhe := v_erros_detalhe || jsonb_build_object('linha', v_n, 'codigo', v_codigo, 'motivo', 'Linha sem ' || v_falta);
      END IF;
      CONTINUE;
    END IF;

    v_existe := EXISTS (SELECT 1 FROM erp_produtos WHERE company_id = p_company_id AND codigo = v_codigo);

    IF p_dry_run THEN
      IF v_existe THEN v_atualizados := v_atualizados + 1; ELSE v_novos := v_novos + 1; END IF;
      CONTINUE;  -- simulação: não grava
    END IF;

    -- GRAVA (cadeia completa, RD-26): upsert + SPED via fn_erp_produto_salvar
    v_dados := jsonb_strip_nulls(jsonb_build_object(
      'codigo', v_codigo, 'nome', v_nome, 'unidade', v_unidade, 'tipo_item_sped', v_tipo,
      'origem', v_origem, 'ncm', v_ncm, 'cest', v_cest, 'preco_venda', v_preco_venda));
    v_res := fn_erp_produto_salvar(p_company_id, v_dados);
    IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
      v_erros := v_erros + 1;
      IF jsonb_array_length(v_erros_detalhe) < 200 THEN
        v_motivo := COALESCE(v_res->>'erro', 'falha ao salvar')
          || CASE WHEN v_res ? 'campos' THEN ' (' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(v_res->'campos') x) || ')' ELSE '' END;
        v_erros_detalhe := v_erros_detalhe || jsonb_build_object('linha', v_n, 'codigo', v_codigo, 'motivo', v_motivo);
      END IF;
      CONTINUE;
    END IF;
    v_pid := (v_res->>'id')::uuid;
    IF v_existe THEN v_atualizados := v_atualizados + 1; ELSE v_novos := v_novos + 1; END IF;

    -- Descritivos + custo médio (mantém o existente quando a linha não traz — igual à tela faz hoje).
    UPDATE erp_produtos SET
      preco_custo_medio      = COALESCE(v_custo, preco_custo_medio),
      custo_medio_origem     = CASE WHEN v_custo IS NOT NULL THEN 'importacao' ELSE custo_medio_origem END,
      estoque_minimo         = COALESCE(v_estoque_min, estoque_minimo),
      categoria              = COALESCE(v_categoria, categoria),
      marca                  = COALESCE(v_marca, marca),
      fornecedor_padrao_nome = COALESCE(v_fornecedor, fornecedor_padrao_nome),
      localizacao            = COALESCE(v_local, localizacao),
      codigo_barras          = COALESCE(v_barras, codigo_barras),
      updated_at             = now()
    WHERE id = v_pid AND company_id = p_company_id;

    -- Saldo por AJUSTE ABSOLUTO (idempotente): põe estoque_atual no valor informado (aceita negativo);
    -- se já bate, ajustado=false (0 movimentação). Reaproveita fn_estoque_ajuste_migracao (a tela já usa).
    v_aj := fn_estoque_ajuste_migracao(v_pid, COALESCE(v_saldo, 0), COALESCE(v_custo, 0),
              COALESCE('Migração · ' || p_arquivo, 'Migração de estoque · planilha padrão PS'));
    IF COALESCE((v_aj->>'ok')::boolean, false) THEN
      IF COALESCE((v_aj->>'ajustado')::boolean, false) THEN v_saldos := v_saldos + 1; ELSE v_sem := v_sem + 1; END IF;
    ELSE
      v_erros := v_erros + 1;
      IF jsonb_array_length(v_erros_detalhe) < 200 THEN
        v_erros_detalhe := v_erros_detalhe || jsonb_build_object('linha', v_n, 'codigo', v_codigo, 'motivo', 'produto ok, saldo falhou: ' || COALESCE(v_aj->>'erro','erro'));
      END IF;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(COALESCE(estoque_atual,0) * COALESCE(preco_custo_medio, preco_custo, 0)), 0)
    INTO v_valor FROM erp_produtos WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'total', v_total,
    'novos', v_novos, 'atualizados', v_atualizados, 'saldos_ajustados', v_saldos, 'sem_mudanca', v_sem,
    'erros', v_erros_detalhe, 'erros_total', v_erros, 'valor_total_estoque', v_valor);
END;
$function$;

-- ACL explícita (fail-closed): nunca anon; só usuário logado e serviço.
REVOKE ALL ON FUNCTION public.fn_estoque_importar_lote(uuid, jsonb, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_estoque_importar_lote(uuid, jsonb, boolean, uuid, text) TO authenticated, service_role;

-- RD-95: "?" do novo botão "Simular (teste)" da tela de importação (texto em linguagem do usuário).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
SELECT 'cadastros.produtos.importar.simular',
       '/dashboard/cadastros/produtos/importar',
       'Migrar estoque',
       'Simular (teste)',
       'Clique em Simular para o sistema conferir a sua planilha SEM gravar nada: ele diz quantos itens são novos, quantos já existem (serão atualizados) e quantas linhas têm erro.',
       'É a janela de teste antes de carregar de verdade. Como só o sistema sabe quais códigos já existem na empresa, a simulação mostra o que vai acontecer — novos, atualizados e erros — para você conferir antes de gravar.',
       'Planilha com 12.125 itens → Simular retorna, em segundos: 11.553 novos, 572 atualizados, 0 erros. Nada é gravado.',
       'Achar que Simular já importou. Ele não grava nada — depois de conferir, clique em Carregar para gravar de verdade.',
       'gestao_empresarial', 165
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'cadastros.produtos.importar.simular');
