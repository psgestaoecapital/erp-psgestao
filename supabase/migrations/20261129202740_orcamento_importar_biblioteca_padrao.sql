-- 20261128120040 · code-desenvolvedor-3 · Tela 334 (Importar orçamento .xlsx) — gap 1 do blueprint §334 (04fd11fa).
-- GAP 1 (essencial, estava AUSENTE): ligar cada item importado à Biblioteca padrão PS de serviços
--   (projetos_ref_servico_padrao, 1.536 serviços da #5777) por descrição + unidade, com SUGESTÃO e GRAU DE
--   CONFIANÇA. O usuário confirma ou escolhe outro serviço da biblioteca; o que não casar vira serviço próprio
--   da empresa. A coluna projetos_orcamento_item_eap.ref_padrao_codigo já existe (criada antes) e a CHECK de
--   origem já aceita 'padrao_ps' | 'empresa' | 'importado' — então esta migration só:
--   (a) [ADITIVA] índice GIN trigram em lower(nome) da biblioteca (busca por semelhança rápida);
--   (b) [ADITIVA] fn_projetos_orcamento_eap_sugerir_padrao: read-only, guarda por empresa, devolve por linha
--       os melhores candidatos da biblioteca (top-5) com confiança (0..1) e se a unidade confere;
--   (c) [CREATE OR REPLACE · SENSÍVEL] fn_projetos_orcamento_eap_importar: passa a PERSISTIR a decisão do
--       usuário — ref_padrao_codigo + origem ('padrao_ps' quando casou, 'empresa' quando é serviço próprio).
--       Backward-compatible: linha SEM a chave 'ref_padrao_codigo' mantém o comportamento antigo (origem
--       'importado', ref NULL). NÃO altera dado de cliente já gravado; corpo VIVO (pg_get_functiondef) preservado.
--   (d) RD-95: chave de ajuda da coluna "Biblioteca padrão PS"; RD-98: registra o novo RPC em system_screens.
-- Guarda de empresa (erp_orcamentos.company_id ∈ get_user_company_ids()) mantida; REVOKE anon reafirmado.
-- RD-38: nenhuma leitura pesada em produção fora de função indexada; similarity() é função C (inlinável), não
--   plpgsql com SET search_path, então não acumula memória por linha.

-- (a) índice de semelhança na biblioteca padrão (lower é imutável → indexável; acentos preservados pelo trgm).
CREATE INDEX IF NOT EXISTS idx_ref_servico_padrao_nome_trgm
  ON public.projetos_ref_servico_padrao USING gin (lower(nome) gin_trgm_ops);

-- (b) sugestão de serviço padrão por linha importada (read-only).
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_eap_sugerir_padrao(
  p_orcamento_id uuid,
  p_linhas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_out     jsonb := '[]'::jsonb;
BEGIN
  -- Guarda de empresa (mesmo padrão de fn_projetos_orcamento_eap_importar_validar).
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

  -- piso do operador % (trgm), transação-local: candidato abaixo disso nem é considerado.
  PERFORM set_config('pg_trgm.similarity_threshold', '0.20', true);

  WITH linhas AS (
    SELECT (t.ordinality)::int AS idx,
           NULLIF(btrim(COALESCE(t.e->>'descricao','')), '') AS descricao,
           NULLIF(btrim(COALESCE(t.e->>'unidade','')), '')   AS unidade
    FROM jsonb_array_elements(p_linhas) WITH ORDINALITY AS t(e, ordinality)
  ),
  cand AS (
    SELECT l.idx,
           r.codigo,
           r.nome,
           r.unidade AS ref_unidade,
           similarity(lower(r.nome), lower(l.descricao)) AS sim,
           (r.unidade IS NOT DISTINCT FROM l.unidade)     AS un_ok,
           row_number() OVER (
             PARTITION BY l.idx
             ORDER BY (similarity(lower(r.nome), lower(l.descricao))
                        + CASE WHEN r.unidade IS NOT DISTINCT FROM l.unidade THEN 0.05 ELSE 0 END) DESC,
                      r.codigo
           ) AS rnk
    FROM linhas l
    JOIN public.projetos_ref_servico_padrao r
      ON r.ativo
     AND lower(r.nome) % lower(l.descricao)
    WHERE l.descricao IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(z.linha ORDER BY z.idx), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT c.idx,
           jsonb_build_object(
             'idx', c.idx,
             'candidatos', jsonb_agg(
               jsonb_build_object(
                 'codigo', c.codigo,
                 'nome', c.nome,
                 'unidade', c.ref_unidade,
                 'confianca', round(c.sim::numeric, 2),
                 'unidade_confere', c.un_ok
               ) ORDER BY c.rnk
             )
           ) AS linha
    FROM cand c
    WHERE c.rnk <= 5
    GROUP BY c.idx
  ) z;

  RETURN jsonb_build_object('ok', true, 'sugestoes', v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_eap_sugerir_padrao(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_eap_sugerir_padrao(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_eap_sugerir_padrao(uuid, jsonb) TO authenticated;

-- (c) persistir a decisão do usuário sobre a biblioteca padrão na gravação (corpo vivo preservado).
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_eap_importar(p_orcamento_id uuid, p_linhas jsonb, p_arquivo_hash text, p_arquivo_nome text DEFAULT NULL::text)
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
  v_ref        text;  -- §334 gap 1: serviço escolhido na biblioteca padrão PS (projetos_ref_servico_padrao)
  v_tem_dec    boolean;  -- a linha trouxe decisão sobre a biblioteca? (chave presente = cliente novo)
  v_origem     text;  -- 'padrao_ps' (casou) | 'empresa' (serviço próprio) | 'importado' (legado)
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

      -- §334 gap 1: decisão do usuário sobre a Biblioteca padrão PS de serviços.
      --   chave 'ref_padrao_codigo' ausente  → cliente antigo: mantém comportamento legado (origem 'importado').
      --   chave presente e não-vazia          → serviço da biblioteca escolhido/confirmado (só vale se existir e ativo).
      --   chave presente e vazia ('')         → o usuário disse "serviço próprio da empresa" (origem 'empresa').
      v_tem_dec := (v_row ? 'ref_padrao_codigo');
      v_ref := NULLIF(btrim(COALESCE(v_row->>'ref_padrao_codigo','')), '');
      IF v_ref IS NOT NULL THEN
        PERFORM 1 FROM public.projetos_ref_servico_padrao WHERE codigo = v_ref AND ativo;
        IF NOT FOUND THEN v_ref := NULL; END IF;  -- código inválido/inativo → trata como serviço próprio
      END IF;
      v_origem := CASE
                    WHEN v_ref IS NOT NULL THEN 'padrao_ps'
                    WHEN v_tem_dec        THEN 'empresa'
                    ELSE 'importado'
                  END;

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

      -- Complemento EAP 1:1 (origem = decisão da biblioteca; ref_padrao_codigo = serviço escolhido)
      INSERT INTO public.projetos_orcamento_item_eap
        (orcamento_item_id, company_id, eap_codigo, ref_padrao_codigo, local_tipo, local_nome,
         quantidade, custo_material_unit, custo_mao_obra_unit, origem)
      VALUES
        (v_item_id, v_company, v_eap, v_ref,
         v_local_tipo,
         NULLIF(btrim(COALESCE(v_row->>'local_nome','')),''),
         v_qtd, v_mat, v_mo, v_origem)
      ON CONFLICT (orcamento_item_id) DO UPDATE
        SET eap_codigo = EXCLUDED.eap_codigo,
            ref_padrao_codigo = EXCLUDED.ref_padrao_codigo,
            local_tipo = EXCLUDED.local_tipo,
            local_nome = EXCLUDED.local_nome,
            quantidade = EXCLUDED.quantidade,
            custo_material_unit = EXCLUDED.custo_material_unit,
            custo_mao_obra_unit = EXCLUDED.custo_mao_obra_unit,
            origem = EXCLUDED.origem,
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

-- Guarda de função (REVOKE anon + só authenticated) — fn_projetos_orcamento_eap_importar é SECURITY DEFINER e grava.
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_eap_importar(uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_eap_importar(uuid, jsonb, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_eap_importar(uuid, jsonb, text, text) TO authenticated, service_role;

-- (d) RD-95: "?" da coluna "Biblioteca padrão PS" na prévia; RD-98: registra o novo RPC em system_screens.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.orcamento_eap.importar_biblioteca',
   '/dashboard/projetos/obras/[id]/orcamento/importar',
   'Importador do orçamento',
   'Biblioteca padrão PS',
   'Confira o serviço da biblioteca padrão PS que casou com cada item da planilha, ou troque pelo correto. Se nenhum serve, deixe como "Serviço próprio da empresa".',
   'Liga o item importado ao serviço de referência da biblioteca PS (descrição + unidade), com um grau de confiança. Isso traz a referência de custo e deixa o orçamento comparável entre obras. O que não casar fica como serviço próprio da sua empresa.',
   'Item "Alvenaria de vedação bloco cerâmico" → sugere "Alvenaria de vedação em bloco cerâmico" (confiança alta, un m²). Confirme ou escolha outro da lista.',
   'Aceitar uma sugestão de confiança baixa só porque apareceu — confira a descrição e a unidade antes de confirmar; na dúvida, deixe como serviço próprio.',
   'projetos', 26, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status;

UPDATE public.system_screens
  SET rpcs_chamadas = (
        SELECT array_agg(DISTINCT x)
        FROM unnest(COALESCE(rpcs_chamadas, ARRAY[]::text[]) || ARRAY['fn_projetos_orcamento_eap_sugerir_padrao']) AS x
      ),
      atualizado_em = now()
  WHERE rota = '/dashboard/projetos/obras/[id]/orcamento/importar'
    AND NOT ('fn_projetos_orcamento_eap_sugerir_padrao' = ANY(COALESCE(rpcs_chamadas, ARRAY[]::text[])));
