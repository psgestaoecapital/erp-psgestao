-- Hub · Onda C-2 · tela 334 (importador xlsx do orçamento por EAP) — BACKEND.
-- Objetivo: a planilha do cliente (padrão Gaia) entra no orçamento da obra sem redigitar.
-- Esta fatia entrega só o backend (ledger de idempotência + RPC de prévia + RPC de import).
-- O parse do .xlsx (SheetJS), o mapeamento de colunas e a tela de preview/confirmar vêm na
-- próxima PR de frontend, consumindo estas RPCs.
-- Aditivo e idempotente: cria uma tabela NOVA e duas funções NOVAS. Não altera estrutura
-- existente. erp_orcamentos_itens e projetos_servicos são gravadas via RPC (como já faz
-- fn_projetos_orcamento_item_eap_salvar), sem colunas novas.
-- RD-26: reaproveita o modelo do item EAP (projetos_orcamento_item_eap) e o catálogo
-- (projetos_servicos). RD-52: arquivo + PR. RD-38: prova no dado no corpo da PR.
-- Code: desenvolvedor_4_g

-- =========================================================================================
-- 1) Ledger de importação (idempotência por hash do arquivo)
-- =========================================================================================
CREATE TABLE IF NOT EXISTS public.projetos_orcamento_importacao (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id  uuid        NOT NULL REFERENCES public.erp_orcamentos(id) ON DELETE CASCADE,
  company_id    uuid        NOT NULL,
  arquivo_hash  text        NOT NULL,
  arquivo_nome  text,
  linhas_total  integer     NOT NULL DEFAULT 0,
  importados    integer     NOT NULL DEFAULT 0,
  ignorados     integer     NOT NULL DEFAULT 0,
  erros         integer     NOT NULL DEFAULT 0,
  detalhe       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  criado_por    uuid        DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projetos_orcamento_importacao_hash_unico UNIQUE (orcamento_id, arquivo_hash)
);

CREATE INDEX IF NOT EXISTS ix_projetos_orc_importacao_orcamento
  ON public.projetos_orcamento_importacao (orcamento_id);

ALTER TABLE public.projetos_orcamento_importacao ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.projetos_orcamento_importacao'::regclass
      AND polname  = 'orc_importacao_select'
  ) THEN
    CREATE POLICY orc_importacao_select
      ON public.projetos_orcamento_importacao
      FOR SELECT
      USING (company_id IN (SELECT get_user_company_ids()));
  END IF;
END$$;

-- Escrita só por RPC (SECURITY DEFINER). Sem policy de INSERT/UPDATE/DELETE para authenticated.
REVOKE ALL ON public.projetos_orcamento_importacao FROM anon;
GRANT SELECT ON public.projetos_orcamento_importacao TO authenticated;

-- =========================================================================================
-- 2) Prévia: valida as linhas SEM gravar nada (alimenta o passo "Confirmar" da tela)
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_eap_importar_validar(
  p_orcamento_id uuid,
  p_linhas       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company   uuid;
  v_total     int := 0;
  v_validos   int := 0;
  v_erro      int := 0;
  v_out       jsonb := '[]'::jsonb;
  v_row       jsonb;
  v_idx       int := 0;
  v_eap       text;
  v_desc      text;
  v_unid      text;
  v_qtd       numeric;
  v_mat       numeric;
  v_mo        numeric;
  v_motivos   text[];
  v_seen      jsonb := '{}'::jsonb;  -- eap_codigo já visto no arquivo (duplicado = aviso)
BEGIN
  -- Guarda de empresa
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'p_linhas deve ser um array JSON' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_linhas) > 10000 THEN
    RAISE EXCEPTION 'limite de 10.000 linhas por importação' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_linhas)
  LOOP
    v_idx    := v_idx + 1;
    v_total  := v_total + 1;
    v_motivos := ARRAY[]::text[];

    -- O CÓDIGO É TEXTO (a planilha real grava "23,1" e perde o zero: 23.1 ≠ 23.10)
    v_eap  := NULLIF(btrim(COALESCE(v_row->>'eap_codigo','')), '');
    v_desc := NULLIF(btrim(COALESCE(v_row->>'descricao','')), '');
    v_unid := NULLIF(btrim(COALESCE(v_row->>'unidade','')), '');

    BEGIN v_qtd := COALESCE((v_row->>'quantidade')::numeric, 0); EXCEPTION WHEN others THEN v_qtd := NULL; END;
    BEGIN v_mat := COALESCE((v_row->>'custo_material_unit')::numeric, 0); EXCEPTION WHEN others THEN v_mat := NULL; END;
    BEGIN v_mo  := COALESCE((v_row->>'custo_mao_obra_unit')::numeric, 0); EXCEPTION WHEN others THEN v_mo := NULL; END;

    IF v_eap IS NULL THEN v_motivos := array_append(v_motivos, 'código EAP vazio'); END IF;
    IF v_desc IS NULL THEN v_motivos := array_append(v_motivos, 'descrição vazia'); END IF;
    IF v_unid IS NULL THEN v_motivos := array_append(v_motivos, 'unidade vazia'); END IF;
    IF v_qtd IS NULL THEN v_motivos := array_append(v_motivos, 'quantidade inválida');
    ELSIF v_qtd < 0 THEN v_motivos := array_append(v_motivos, 'quantidade negativa'); END IF;
    IF v_mat IS NULL THEN v_motivos := array_append(v_motivos, 'custo de material inválido');
    ELSIF v_mat < 0 THEN v_motivos := array_append(v_motivos, 'custo de material negativo'); END IF;
    IF v_mo IS NULL THEN v_motivos := array_append(v_motivos, 'custo de mão de obra inválido');
    ELSIF v_mo < 0 THEN v_motivos := array_append(v_motivos, 'custo de mão de obra negativo'); END IF;
    IF v_eap IS NOT NULL AND (v_seen ? v_eap) THEN
      v_motivos := array_append(v_motivos, 'código EAP duplicado no arquivo');
    END IF;
    IF v_eap IS NOT NULL THEN v_seen := v_seen || jsonb_build_object(v_eap, true); END IF;

    IF array_length(v_motivos, 1) IS NULL THEN
      v_validos := v_validos + 1;
      v_out := v_out || jsonb_build_object(
        'idx', v_idx, 'eap_codigo', v_eap, 'descricao', v_desc, 'unidade', v_unid,
        'quantidade', v_qtd, 'custo_material_unit', v_mat, 'custo_mao_obra_unit', v_mo,
        'local_tipo', NULLIF(btrim(COALESCE(v_row->>'local_tipo','')),''),
        'local_nome', NULLIF(btrim(COALESCE(v_row->>'local_nome','')),''),
        'status', 'ok', 'motivos', '[]'::jsonb);
    ELSE
      v_erro := v_erro + 1;
      v_out := v_out || jsonb_build_object(
        'idx', v_idx, 'eap_codigo', v_eap, 'descricao', v_desc, 'unidade', v_unid,
        'quantidade', v_qtd, 'custo_material_unit', v_mat, 'custo_mao_obra_unit', v_mo,
        'status', 'erro', 'motivos', to_jsonb(v_motivos));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'linhas_total', v_total,
    'validos', v_validos,
    'com_erro', v_erro,
    'linhas', v_out
  );
END;
$function$;

-- =========================================================================================
-- 3) Import: grava os itens válidos. Idempotente por hash do arquivo.
--    Reaproveita o MESMO modelo de escrita de fn_projetos_orcamento_item_eap_salvar
--    (item em erp_orcamentos_itens + complemento projetos_orcamento_item_eap), porém
--    com origem='importado' e em lote. O insert é inline (não chama a RPC por linha) para
--    não acumular memória por chamada em volume (incidente 03/10: função com SET search_path
--    não é inlinada; o limite aqui é 10 mil linhas).
-- =========================================================================================
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_eap_importar(
  p_orcamento_id uuid,
  p_linhas       jsonb,
  p_arquivo_hash text,
  p_arquivo_nome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company    uuid;
  v_existente  public.projetos_orcamento_importacao%ROWTYPE;
  v_total      int := 0;
  v_importados int := 0;
  v_ignorados  int := 0;
  v_erros      int := 0;
  v_detalhe    jsonb := '[]'::jsonb;
  v_row        jsonb;
  v_idx        int := 0;
  v_eap        text;
  v_desc       text;
  v_unid       text;
  v_qtd        numeric;
  v_mat        numeric;
  v_mo         numeric;
  v_unit       numeric;
  v_servico_id uuid;
  v_item_id    uuid;
  v_motivo     text;
  v_eap_padrao text;  -- a EAP só entra no serviço se existir na biblioteca padrão (FK)
  v_local_tipo text;  -- o local_tipo só entra se existir em projetos_local_tipo (FK)
BEGIN
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(COALESCE(p_arquivo_hash,'')), '') IS NULL THEN
    RAISE EXCEPTION 'hash do arquivo obrigatório para idempotência' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'p_linhas deve ser um array JSON' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_linhas) > 10000 THEN
    RAISE EXCEPTION 'limite de 10.000 linhas por importação' USING ERRCODE = '22023';
  END IF;

  -- Idempotência: mesmo arquivo (hash) já importado neste orçamento → devolve o resultado anterior
  SELECT * INTO v_existente
  FROM public.projetos_orcamento_importacao
  WHERE orcamento_id = p_orcamento_id AND arquivo_hash = p_arquivo_hash;
  IF v_existente.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'ja_importado', true, 'importacao_id', v_existente.id,
      'linhas_total', v_existente.linhas_total, 'importados', v_existente.importados,
      'ignorados', v_existente.ignorados, 'erros', v_existente.erros,
      'detalhe', v_existente.detalhe
    );
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_linhas)
  LOOP
    v_idx   := v_idx + 1;
    v_total := v_total + 1;
    v_motivo := NULL;

    v_eap  := NULLIF(btrim(COALESCE(v_row->>'eap_codigo','')), '');
    v_desc := NULLIF(btrim(COALESCE(v_row->>'descricao','')), '');
    v_unid := NULLIF(btrim(COALESCE(v_row->>'unidade','')), '');
    BEGIN v_qtd := COALESCE((v_row->>'quantidade')::numeric, 0); EXCEPTION WHEN others THEN v_qtd := NULL; END;
    BEGIN v_mat := COALESCE((v_row->>'custo_material_unit')::numeric, 0); EXCEPTION WHEN others THEN v_mat := NULL; END;
    BEGIN v_mo  := COALESCE((v_row->>'custo_mao_obra_unit')::numeric, 0); EXCEPTION WHEN others THEN v_mo := NULL; END;

    IF v_eap IS NULL THEN v_motivo := 'código EAP vazio';
    ELSIF v_desc IS NULL THEN v_motivo := 'descrição vazia';
    ELSIF v_unid IS NULL THEN v_motivo := 'unidade vazia';
    ELSIF v_qtd IS NULL OR v_qtd < 0 THEN v_motivo := 'quantidade inválida';
    ELSIF v_mat IS NULL OR v_mat < 0 THEN v_motivo := 'custo de material inválido';
    ELSIF v_mo IS NULL OR v_mo < 0 THEN v_motivo := 'custo de mão de obra inválido';
    END IF;

    IF v_motivo IS NOT NULL THEN
      v_erros := v_erros + 1;
      v_detalhe := v_detalhe || jsonb_build_object('idx', v_idx, 'eap_codigo', v_eap, 'status', 'erro', 'motivo', v_motivo);
      CONTINUE;
    END IF;

    BEGIN
      v_unit := v_mat + v_mo;

      -- A biblioteca padrão (projetos_eap_padrao) é a referência da FK do serviço: o código do
      -- arquivo só vira o eap_codigo do serviço quando existe lá; senão fica NULL (nó próprio da
      -- empresa, guardado no complemento do item, que não tem FK).
      SELECT p.codigo INTO v_eap_padrao FROM public.projetos_eap_padrao p WHERE p.codigo = v_eap;
      -- local_tipo: só entra se for um tipo de local conhecido (FK); senão fica NULL (mantém o nome).
      SELECT lt.codigo INTO v_local_tipo FROM public.projetos_local_tipo lt
        WHERE lt.codigo = NULLIF(btrim(COALESCE(v_row->>'local_tipo','')), '');

      -- Catálogo da empresa: upsert do serviço por (company_id, codigo). O código é a EAP do arquivo.
      INSERT INTO public.projetos_servicos
        (company_id, codigo, nome, descricao, unidade, custo_material, custo_mao_obra,
         custo_unitario_total, eap_codigo, source_type, ativo)
      VALUES
        (v_company, v_eap, v_desc, v_desc, v_unid, v_mat, v_mo, v_unit, v_eap_padrao, 'importado', true)
      ON CONFLICT (company_id, codigo) DO UPDATE
        SET nome = EXCLUDED.nome,
            unidade = EXCLUDED.unidade,
            custo_material = EXCLUDED.custo_material,
            custo_mao_obra = EXCLUDED.custo_mao_obra,
            custo_unitario_total = EXCLUDED.custo_unitario_total,
            eap_codigo = EXCLUDED.eap_codigo,
            deleted_at = NULL,
            updated_at = now()
      RETURNING id INTO v_servico_id;

      -- Item do orçamento (mesmo modelo de fn_projetos_orcamento_item_eap_salvar)
      INSERT INTO public.erp_orcamentos_itens
        (orcamento_id, company_id, tipo_item, servico_id, servico_codigo, servico_descricao,
         unidade, quantidade, preco_unitario, preco_custo, subtotal)
      VALUES
        (p_orcamento_id, v_company, 'servico', v_servico_id, v_eap, v_desc,
         v_unid, v_qtd, v_unit, v_unit, round(v_qtd * v_unit, 2))
      RETURNING id INTO v_item_id;

      -- Complemento EAP 1:1 (origem = importado)
      INSERT INTO public.projetos_orcamento_item_eap
        (orcamento_item_id, company_id, eap_codigo, local_tipo, local_nome,
         quantidade, custo_material_unit, custo_mao_obra_unit, origem)
      VALUES
        (v_item_id, v_company, v_eap,
         v_local_tipo,
         NULLIF(btrim(COALESCE(v_row->>'local_nome','')),''),
         v_qtd, v_mat, v_mo, 'importado')
      ON CONFLICT (orcamento_item_id) DO UPDATE
        SET eap_codigo = EXCLUDED.eap_codigo,
            local_tipo = EXCLUDED.local_tipo,
            local_nome = EXCLUDED.local_nome,
            quantidade = EXCLUDED.quantidade,
            custo_material_unit = EXCLUDED.custo_material_unit,
            custo_mao_obra_unit = EXCLUDED.custo_mao_obra_unit,
            origem = 'importado',
            atualizado_em = now();

      v_importados := v_importados + 1;
    EXCEPTION WHEN others THEN
      v_ignorados := v_ignorados + 1;
      v_detalhe := v_detalhe || jsonb_build_object('idx', v_idx, 'eap_codigo', v_eap, 'status', 'ignorado', 'motivo', SQLERRM);
    END;
  END LOOP;

  INSERT INTO public.projetos_orcamento_importacao
    (orcamento_id, company_id, arquivo_hash, arquivo_nome, linhas_total, importados, ignorados, erros, detalhe)
  VALUES
    (p_orcamento_id, v_company, p_arquivo_hash, NULLIF(btrim(COALESCE(p_arquivo_nome,'')),''),
     v_total, v_importados, v_ignorados, v_erros, v_detalhe)
  RETURNING id INTO v_item_id;

  RETURN jsonb_build_object(
    'ok', true, 'ja_importado', false, 'importacao_id', v_item_id,
    'linhas_total', v_total, 'importados', v_importados,
    'ignorados', v_ignorados, 'erros', v_erros, 'detalhe', v_detalhe
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_eap_importar_validar(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_eap_importar(uuid, jsonb, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_eap_importar_validar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_eap_importar(uuid, jsonb, text, text) TO authenticated;
