-- Faturamento LÍQUIDO no painel comercial = Faturamento BRUTO − Devoluções (tipos que abatem)
-- + indicador separado de DESCARTE / PERDA. Decisão travada com o CEO (12/11/2026).
--
-- Contexto (prova RD-38, leitura em produção, empresa industrial Frioeste, out/2026):
--   bruto (bi_comercial_venda_item_mv)           = R$ 11.585.223,62
--   devoluções T582+T583 (comercial_devolucao)   = R$    342.680,46
--   faturamento líquido                          = R$ 11.242.543,16
-- A venda (comercial_venda_item / bi_comercial_venda_item_mv) permanece BRUTA e NÃO é alterada:
-- isto é só EXIBIÇÃO (card novo "Faturamento líquido" ao lado do bruto). Não se desconta duas vezes.
--
-- Os TIPOS que abatem são configuráveis por empresa (RD-102), com padrão global da PS (T582, T583).
-- O DESCARTE usa o tipo T131 (produto devolvido e inutilizado por qualidade), que ainda NÃO é
-- coletado pelo conector do sistema de origem: a tela já trata o tipo e mostra
-- "aguardando integração" enquanto não houver dado.
--
-- Aditiva: cria 1 tabela + 1 índice + RLS/policies + 2 funções de leitura; estende (CREATE OR REPLACE,
-- só ACRÉSCIMO de campos) a fn_bi_comercial_kpis (a RPC que alimenta os cards do topo do painel
-- /dashboard/inteligencia/comercial); semeia ajuda (RD-95). Sem DROP/DELETE/UPDATE em massa.

-- =====================================================================================
-- 1) Configuração por empresa dos tipos de movimento (RD-102, molde erp_venda_params)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.erp_comercial_tipo_movimento (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        REFERENCES public.companies(id) ON DELETE CASCADE, -- NULL = padrão global PS
  categoria      text        NOT NULL CHECK (categoria IN ('devolucao_abate','descarte')),
  cod_tipo_mv    text        NOT NULL,
  descricao      text,
  ativo          boolean     NOT NULL DEFAULT true,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

COMMENT ON TABLE public.erp_comercial_tipo_movimento IS
  'Tipos de movimento (COD_TIPO_MV) que entram no cálculo do painel comercial: devolucao_abate = abatem do faturamento líquido; descarte = perda (indicador próprio). company_id NULL = padrão global PS; linha por empresa sobrepõe o padrão.';

-- Unicidade tratando NULL (padrão global) como uma chave concreta.
CREATE UNIQUE INDEX IF NOT EXISTS ux_comercial_tipo_mov_empresa
  ON public.erp_comercial_tipo_movimento
     (COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid), categoria, cod_tipo_mv);

ALTER TABLE public.erp_comercial_tipo_movimento ENABLE ROW LEVEL SECURITY;

-- Leitura: padrão global (company_id NULL) + a própria empresa; PS admin vê tudo. Fail-closed.
DROP POLICY IF EXISTS erp_comercial_tipo_mov_sel ON public.erp_comercial_tipo_movimento;
CREATE POLICY erp_comercial_tipo_mov_sel ON public.erp_comercial_tipo_movimento
  FOR SELECT TO authenticated
  USING (company_id IS NULL
         OR company_id IN (SELECT get_user_company_ids())
         OR is_admin());

-- Escrita: só a própria empresa (ou PS admin). Padrão global (NULL) só por PS admin.
DROP POLICY IF EXISTS erp_comercial_tipo_mov_ins ON public.erp_comercial_tipo_movimento;
CREATE POLICY erp_comercial_tipo_mov_ins ON public.erp_comercial_tipo_movimento
  FOR INSERT TO authenticated
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

DROP POLICY IF EXISTS erp_comercial_tipo_mov_upd ON public.erp_comercial_tipo_movimento;
CREATE POLICY erp_comercial_tipo_mov_upd ON public.erp_comercial_tipo_movimento
  FOR UPDATE TO authenticated
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

DROP POLICY IF EXISTS erp_comercial_tipo_mov_del ON public.erp_comercial_tipo_movimento;
CREATE POLICY erp_comercial_tipo_mov_del ON public.erp_comercial_tipo_movimento
  FOR DELETE TO authenticated
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin());

REVOKE ALL ON public.erp_comercial_tipo_movimento FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_comercial_tipo_movimento TO authenticated;

-- Padrão global PS (idempotente). Descrições genéricas (RD-100: sem nome de sistema de origem).
INSERT INTO public.erp_comercial_tipo_movimento (company_id, categoria, cod_tipo_mv, descricao)
SELECT * FROM (VALUES
  (NULL::uuid, 'devolucao_abate', 'T582', 'Devolução de venda — NF própria (entrada)'),
  (NULL::uuid, 'devolucao_abate', 'T583', 'Devolução de venda — NF do cliente (CFOP 1202/2202)'),
  (NULL::uuid, 'descarte',        'T131', 'Descarte / perda — produto devolvido e inutilizado por qualidade')
) AS v(company_id, categoria, cod_tipo_mv, descricao)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_comercial_tipo_movimento e
  WHERE e.company_id IS NOT DISTINCT FROM v.company_id
    AND e.categoria = v.categoria AND e.cod_tipo_mv = v.cod_tipo_mv);

-- =====================================================================================
-- 2) Leitura dos tipos efetivos (por empresa com fallback para o padrão global)
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_comercial_tipos_efetivos(p_company_id uuid, p_categoria text)
 RETURNS TABLE (cod_tipo_mv text, descricao text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH proprios AS (
    SELECT t.cod_tipo_mv, t.descricao
    FROM public.erp_comercial_tipo_movimento t
    WHERE t.categoria = p_categoria AND t.ativo AND t.company_id = p_company_id
  )
  SELECT cod_tipo_mv, descricao FROM proprios
  UNION ALL
  SELECT t.cod_tipo_mv, t.descricao
  FROM public.erp_comercial_tipo_movimento t
  WHERE t.categoria = p_categoria AND t.ativo AND t.company_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM proprios)   -- só cai no global se a empresa não configurou
  ORDER BY 1;
$function$;

REVOKE ALL ON FUNCTION public.fn_comercial_tipos_efetivos(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_comercial_tipos_efetivos(uuid, text) TO authenticated;

-- RPC pública (para a tela mostrar "quais tipos entram") — guarda de empresa, fail-closed.
CREATE OR REPLACE FUNCTION public.fn_comercial_tipo_movimento_listar(p_company_id uuid, p_categoria text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'devolucao_abate', COALESCE((SELECT jsonb_agg(jsonb_build_object('cod', cod_tipo_mv, 'descricao', descricao))
                                 FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate')), '[]'::jsonb),
    'descarte',        COALESCE((SELECT jsonb_agg(jsonb_build_object('cod', cod_tipo_mv, 'descricao', descricao))
                                 FROM public.fn_comercial_tipos_efetivos(p_company_id, 'descarte')), '[]'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION public.fn_comercial_tipo_movimento_listar(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_comercial_tipo_movimento_listar(uuid, text) TO authenticated;

-- =====================================================================================
-- 3) fn_bi_comercial_kpis: ACRESCENTA devoluções, faturamento líquido e descarte.
--    É a RPC que alimenta os cards do topo (/dashboard/inteligencia/comercial).
--    TODOS os campos existentes preservados; só ADIÇÃO. Guarda e escopo (vendedor) inalterados.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fn_bi_comercial_kpis(p_company_id uuid, p_dt_ini date, p_dt_fim date, p_vendedor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope jsonb; v_vend text; r RECORD;
  v_tipos_dev  text[];
  v_tipos_desc text[];
  v_dev_valor  numeric := 0;
  v_dev_kg     numeric := 0;
  v_dev_tipos  jsonb   := '[]'::jsonb;
  v_desc_valor numeric := 0;
  v_desc_kg    numeric := 0;
  v_desc_linhas int    := 0;
  v_desc_prod  jsonb   := '[]'::jsonb;
  v_desc_vend  jsonb   := '[]'::jsonb;
  v_desc_linha jsonb   := '[]'::jsonb;
BEGIN
  v_scope := public.fn_bi_comercial_scope(p_company_id);
  IF v_scope->>'modo' = 'sem_acesso' THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_comercial'); END IF;
  v_vend := CASE WHEN v_scope->>'modo' = 'vendedor' THEN v_scope->>'cod' ELSE p_vendedor END;

  -- Venda (BRUTO) — fonte e filtros inalterados.
  SELECT COALESCE(SUM(m.kg), 0) AS volume_kg,
         COALESCE(SUM(m.valor), 0) AS faturamento,
         COUNT(DISTINCT m.cliente_cod) AS clientes,
         COUNT(DISTINCT upper(translate(split_part(m.cidade, '/', 1), 'ÁÀÂÃÉÈÊÍÌÓÒÔÕÚÙÇáàâãéèêíìóòôõúùç', 'AAAAEEEIIOOOUUCaaaaeeeiiooouuc'))) AS cidades,
         COALESCE(SUM(m.kg) FILTER (WHERE c.status = 'entra'), 0) AS kg_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE c.status = 'entra'), 0) AS faturamento_com_selecao,
         COALESCE(SUM(m.valor) FILTER (WHERE m.carne), 0) AS faturamento_sem_despojo,
         COALESCE(SUM(m.kg) FILTER (WHERE m.carne), 0) AS volume_kg_sem_despojo
    INTO r
    FROM public.bi_comercial_venda_item_mv m
    LEFT JOIN public.bi_comercial_produto_classificacao c ON c.company_id = m.company_id AND c.cod_produto = m.produto_cod
   WHERE m.company_id = p_company_id AND m.dia BETWEEN p_dt_ini AND p_dt_fim
     AND (v_vend IS NULL OR m.vendedor = v_vend);

  -- Tipos configurados (por empresa com fallback global).
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_dev
    FROM public.fn_comercial_tipos_efetivos(p_company_id, 'devolucao_abate');
  SELECT array_agg(cod_tipo_mv) INTO v_tipos_desc
    FROM public.fn_comercial_tipos_efetivos(p_company_id, 'descarte');

  -- DEVOLUÇÕES que abatem (domínio comercial_devolucao). Mesmos filtros do BI + MESMO escopo de vendedor:
  -- STATUS<>'C', DATA_MOVTO no período, valor = VALOR_LIQUIDO_ITEM, kg = QTDE_PRI quando KG.
  IF v_tipos_dev IS NOT NULL AND cardinality(v_tipos_dev) > 0 THEN
    WITH d AS (
      SELECT f.raw->>'COD_TIPO_MV' AS cod,
             (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric AS valor,
             CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG'
                  THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END AS kg
      FROM public.ind_atak_fato f
      WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
        AND trim(f.raw->>'STATUS') <> 'C'
        AND left(f.raw->>'DATA_MOVTO', 10) >= to_char(p_dt_ini, 'YYYY-MM-DD')
        AND left(f.raw->>'DATA_MOVTO', 10) <= to_char(p_dt_fim, 'YYYY-MM-DD')
        AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_dev)
        AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_vend)
    )
    SELECT round(COALESCE(sum(valor), 0), 2),
           round(COALESCE(sum(kg), 0), 3),
           COALESCE(jsonb_agg(jsonb_build_object('cod', cod, 'valor', valor, 'kg', kg) ORDER BY cod), '[]'::jsonb)
      INTO v_dev_valor, v_dev_kg, v_dev_tipos
      FROM (SELECT cod, round(sum(valor), 2) valor, round(sum(kg), 3) kg FROM d GROUP BY cod) z;
  END IF;

  -- DESCARTE / PERDA (indicador separado — NÃO abate do faturamento). Hoje T131 ainda não vem.
  IF v_tipos_desc IS NOT NULL AND cardinality(v_tipos_desc) > 0 THEN
    SELECT COALESCE(round(sum((f.raw->>'VALOR_LIQUIDO_ITEM')::numeric), 2), 0),
           COALESCE(round(sum(CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI') = 'KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric, 0) ELSE 0 END), 3), 0),
           count(*)
      INTO v_desc_valor, v_desc_kg, v_desc_linhas
      FROM public.ind_atak_fato f
      WHERE f.company_id = p_company_id AND f.dominio = 'comercial_devolucao'
        AND trim(f.raw->>'STATUS') <> 'C'
        AND left(f.raw->>'DATA_MOVTO', 10) BETWEEN to_char(p_dt_ini, 'YYYY-MM-DD') AND to_char(p_dt_fim, 'YYYY-MM-DD')
        AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
        AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'), ''), 's/v') = v_vend);

    IF v_desc_linhas > 0 THEN
      -- quebras por produto / vendedor / linha (só quando houver descarte coletado)
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_prod FROM (
        SELECT jsonb_build_object('produto', produto, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT left(trim(f.raw->>'DESC_PRODUTO_NF'),60) produto,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY produto ) q;
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_vend FROM (
        SELECT jsonb_build_object('vendedor', vendedor_nome, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT COALESCE(NULLIF(left(trim(f.raw->>'NOME_COMP'),60),''),'s/v') vendedor_nome,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY vendedor_nome ) q;
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor')::numeric DESC), '[]'::jsonb) INTO v_desc_linha FROM (
        SELECT jsonb_build_object('linha', linha, 'valor', round(sum(valor),2), 'kg', round(sum(kg),3)) x
        FROM ( SELECT left(trim(f.raw->>'DESC_DIVISAO'),60) linha,
                      (f.raw->>'VALOR_LIQUIDO_ITEM')::numeric valor,
                      CASE WHEN trim(f.raw->>'COD_UNIDADE_PRI')='KG' THEN COALESCE((f.raw->>'QTDE_PRI')::numeric,0) ELSE 0 END kg
               FROM public.ind_atak_fato f
               WHERE f.company_id=p_company_id AND f.dominio='comercial_devolucao' AND trim(f.raw->>'STATUS')<>'C'
                 AND left(f.raw->>'DATA_MOVTO',10) BETWEEN to_char(p_dt_ini,'YYYY-MM-DD') AND to_char(p_dt_fim,'YYYY-MM-DD')
                 AND f.raw->>'COD_TIPO_MV' = ANY (v_tipos_desc)
                 AND (v_vend IS NULL OR COALESCE(NULLIF(trim(f.raw->>'COD_VEND_COMP'),''),'s/v') = v_vend) ) s
        GROUP BY linha ) q;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'escopo', v_scope->>'modo', 'vendedor', v_vend,
    'volume_kg', r.volume_kg, 'faturamento', r.faturamento, 'clientes', r.clientes, 'cidades', r.cidades,
    'ticket_kg', ROUND(r.faturamento / NULLIF(r.volume_kg, 0), 4),
    'ticket_cliente', ROUND(r.faturamento / NULLIF(r.clientes, 0), 2),
    'faturamento_com_selecao', r.faturamento_com_selecao,
    'volume_kg_com_selecao', r.kg_com_selecao,
    'ticket_kg_com_selecao', ROUND(r.faturamento_com_selecao / NULLIF(r.kg_com_selecao, 0), 4),
    'faturamento_sem_despojo', r.faturamento_sem_despojo,
    'volume_kg_sem_despojo', r.volume_kg_sem_despojo,
    'ticket_kg_sem_despojo', ROUND(r.faturamento_sem_despojo / NULLIF(r.volume_kg_sem_despojo, 0), 4),
    'lucro', NULL, 'margem_pct', NULL, 'lucro_status', 'aguardando_dado_confiavel', 'fonte', 'venda_item_aceite',
    -- NOVOS (faturamento líquido + descarte). O card "Faturamento total" segue sendo o BRUTO (r.faturamento).
    'devolucoes_valor',    v_dev_valor,
    'devolucoes_kg',       v_dev_kg,
    'devolucoes_por_tipo', v_dev_tipos,
    'tipos_devolucao',     COALESCE(to_jsonb(v_tipos_dev), '[]'::jsonb),
    'faturamento_liquido', round(COALESCE(r.faturamento, 0) - v_dev_valor, 2),
    'volume_kg_liquido',   round(COALESCE(r.volume_kg, 0) - v_dev_kg, 3),
    'descarte', jsonb_build_object(
       'status',       CASE WHEN v_desc_linhas > 0 THEN 'ok' ELSE 'aguardando_integracao' END,
       'tipos',        COALESCE(to_jsonb(v_tipos_desc), '[]'::jsonb),
       'total_valor',  v_desc_valor,
       'total_kg',     v_desc_kg,
       'por_produto',  v_desc_prod,
       'por_vendedor', v_desc_vend,
       'por_linha',    v_desc_linha));
END
$function$;

-- Mantém as permissões originais da função.
REVOKE ALL ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_kpis(uuid, date, date, text) TO authenticated;

-- =====================================================================================
-- 4) Ajuda de campo (RD-95) — "?" dos novos indicadores.
-- =====================================================================================
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('comercial.bi.faturamento_liquido', '/dashboard/inteligencia/comercial', 'Totais do topo', 'Faturamento líquido',
   'Nada a preencher: é um indicador calculado. Faturamento líquido = Faturamento total (bruto) − Devoluções do período.',
   'Mostra o que de fato ficou depois de descontar as devoluções de venda. Serve para bater com o relatório de devoluções do sistema de origem, sem mexer na venda (que continua bruta).',
   'Bruto R$ 11.585.223,62 − Devoluções R$ 342.680,46 = Líquido R$ 11.242.543,16.',
   'Confundir com o faturamento total: o total continua sendo o bruto; o líquido é só a leitura já sem devoluções.',
   'comercial', 15, 'publicado'),
  ('comercial.bi.devolucoes', '/dashboard/inteligencia/comercial', 'Totais do topo', 'Devoluções',
   'Nada a preencher: soma das devoluções de venda do período, pelos tipos de movimento configurados para a empresa (padrão T582 e T583).',
   'É o quanto voltou de venda no período. Abate do faturamento líquido. Os tipos que entram são configuráveis por empresa, para não ficar engessado.',
   'No mês, R$ 342.680,46 em devoluções (T582).',
   'Achar que já está descontado do faturamento total — não está: o total é bruto, a devolução aparece à parte e no líquido.',
   'comercial', 16, 'publicado'),
  ('comercial.bi.descarte', '/dashboard/inteligencia/comercial', 'Totais do topo', 'Descarte / Perda',
   'Nada a preencher: produto devolvido e inutilizado por qualidade/problema (tipo T131). NÃO entra no faturamento — é indicador próprio.',
   'Mede a perda real (kg e R$) por produto, vendedor e linha. Separa "voltou e foi descartado" de "voltou e foi reaproveitado".',
   'Quando integrado: 1.200 kg de descarte, R$ 18.000, concentrado em um produto.',
   'Somar o descarte com as devoluções — são coisas distintas; descarte é perda, não devolução que abate.',
   'comercial', 17, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.rota = v.rota AND e.chave = v.chave);
