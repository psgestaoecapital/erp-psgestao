-- ============================================================
-- ONDA 10 · CRM da revenda ESTENDE o CRM da GE (nao recria)
-- O CRM da GE e maduro (funil, semaforo, historico, desempenho, visita GPS, ~20 RPCs).
-- Falta so: ele nao sabe o que e um veiculo. Duas colunas na oportunidade + a procura sem estoque.
-- Nao mexe no funil da GE: erp_crm_oportunidade so ganha duas colunas opcionais.
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 · as duas pontas de veiculo na oportunidade
-- ------------------------------------------------------------
ALTER TABLE public.erp_crm_oportunidade
  ADD COLUMN IF NOT EXISTS veic_interesse_id uuid
    REFERENCES public.veic_veiculo(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS veic_avaliacao_id uuid
    REFERENCES public.veic_veiculo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_crm_oport_veic_interesse
  ON public.erp_crm_oportunidade (veic_interesse_id) WHERE veic_interesse_id IS NOT NULL;

COMMENT ON COLUMN public.erp_crm_oportunidade.veic_interesse_id IS
  'Veiculo do patio que o cliente quer comprar. NULL = oportunidade nao e de revenda.';
COMMENT ON COLUMN public.erp_crm_oportunidade.veic_avaliacao_id IS
  'Veiculo que o cliente quer dar na troca, ja no estoque como avaliacao.';

-- ------------------------------------------------------------
-- 2.2 · procura sem estoque — o que o cliente queria e a loja nao tinha
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.veic_procura (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  oportunidade_id uuid REFERENCES public.erp_crm_oportunidade(id) ON DELETE SET NULL,
  cliente_nome   text,
  contato        text,
  marca          text,
  modelo         text,
  ano_min        int,
  ano_max        int,
  valor_ate      numeric,
  cambio         text,
  observacao     text,
  atendida_em    timestamptz,
  atendida_veiculo_id uuid REFERENCES public.veic_veiculo(id) ON DELETE SET NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid
);
CREATE INDEX IF NOT EXISTS ix_veic_procura_aberta
  ON public.veic_procura (company_id, marca, modelo) WHERE atendida_em IS NULL;

ALTER TABLE public.veic_procura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veic_procura_rw ON public.veic_procura;
CREATE POLICY veic_procura_rw ON public.veic_procura FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- ------------------------------------------------------------
-- 3.1 · abre oportunidade a partir de um veiculo do patio.
--       REUSA fn_crm_oportunidade_obter_ou_criar (nao cria funil paralelo) e grava veic_interesse_id.
--       cliente: {cliente_id} existente, ou {nome, contato} para criar inline.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_oportunidade_abrir(p_veiculo_id uuid, p_cliente jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_vec record; v_cli uuid; v_titulo text; v_op uuid; v_aval uuid;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT id, marca, modelo, ano_modelo INTO v_vec FROM veic_veiculo WHERE id = p_veiculo_id AND deleted_at IS NULL;
  IF v_vec.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'veiculo_nao_encontrado'); END IF;

  -- resolve o cliente: usa o informado, ou cria inline (nome + contato)
  v_cli := NULLIF(p_cliente->>'cliente_id','')::uuid;
  IF v_cli IS NULL THEN
    IF NULLIF(btrim(p_cliente->>'nome'),'') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'nome_obrigatorio', 'campo', 'nome'); END IF;
    v_cli := public.fn_cliente_criar_inline(
      v_comp, p_cliente->>'nome', NULLIF(p_cliente->>'cpf_cnpj',''),
      jsonb_build_object('telefone', NULLIF(btrim(p_cliente->>'contato'),'')));
  ELSE
    -- garante que o cliente informado e do tenant do veiculo
    IF NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = v_cli AND company_id = v_comp) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'cliente_de_outra_empresa'); END IF;
  END IF;

  v_titulo := COALESCE(NULLIF(btrim(p_cliente->>'titulo'),''),
    btrim(COALESCE(v_vec.marca,'') || ' ' || COALESCE(v_vec.modelo,''))
      || CASE WHEN v_vec.ano_modelo IS NOT NULL THEN ' ' || v_vec.ano_modelo::text ELSE '' END);
  v_titulo := NULLIF(v_titulo, '');

  -- o funil e o da GE (etapas, semaforo, historico, desempenho continuam sendo os dela)
  v_op := public.fn_crm_oportunidade_obter_ou_criar(v_cli, v_titulo);

  v_aval := NULLIF(p_cliente->>'veic_avaliacao_id','')::uuid;
  UPDATE erp_crm_oportunidade
     SET veic_interesse_id = p_veiculo_id,
         veic_avaliacao_id = COALESCE(v_aval, veic_avaliacao_id),
         updated_at = now()
   WHERE id = v_op;

  RETURN jsonb_build_object('ok', true, 'oportunidade_id', v_op, 'cliente_id', v_cli, 'veiculo_id', p_veiculo_id);
END $function$;

-- ------------------------------------------------------------
-- 3.2 · quem esta interessado neste carro (ficha + card do patio)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_interessados(p_veiculo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v jsonb;
BEGIN
  v_comp := public.fn_veic_acesso(p_veiculo_id);
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'dias_na_etapa')::int DESC), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'oportunidade_id', o.id,
      'cliente', COALESCE(NULLIF(btrim(c.nome_fantasia),''), NULLIF(btrim(c.razao_social),''), 'Cliente'),
      'contato', COALESCE(NULLIF(btrim(c.whatsapp),''), NULLIF(btrim(c.celular),''), NULLIF(btrim(c.telefone),'')),
      'etapa', o.etapa,
      'valor_estimado', o.valor_estimado,
      'responsavel_nome', o.responsavel_nome,
      'dias_na_etapa', GREATEST(0, (CURRENT_DATE - COALESCE(
        (SELECT max(h.criado_em) FROM erp_crm_oportunidade_historico h
          WHERE h.oportunidade_id = o.id AND h.para_etapa = o.etapa),
        o.created_at)::date))
    ) AS x
    FROM erp_crm_oportunidade o
    LEFT JOIN erp_clientes c ON c.id = o.cliente_id
    WHERE o.veic_interesse_id = p_veiculo_id AND o.deleted_at IS NULL
      AND o.etapa NOT IN ('ganho','perdido')
  ) t;

  RETURN jsonb_build_object('ok', true, 'total', jsonb_array_length(v), 'interessados', v);
END $function$;

-- ------------------------------------------------------------
-- 3.3 · registra a procura sem estoque (o que o cliente queria e a loja nao tinha)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_procura_registrar(p_company_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_marca text; v_modelo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_marca  := NULLIF(btrim(p_dados->>'marca'), '');
  v_modelo := NULLIF(btrim(p_dados->>'modelo'), '');
  IF v_marca IS NULL AND v_modelo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'marca_ou_modelo_obrigatorio', 'campo', 'modelo'); END IF;

  INSERT INTO veic_procura (company_id, oportunidade_id, cliente_nome, contato, marca, modelo,
      ano_min, ano_max, valor_ate, cambio, observacao, criado_por)
  VALUES (p_company_id, NULLIF(p_dados->>'oportunidade_id','')::uuid,
      NULLIF(btrim(p_dados->>'cliente_nome'),''), NULLIF(btrim(p_dados->>'contato'),''),
      v_marca, v_modelo,
      NULLIF(p_dados->>'ano_min','')::int, NULLIF(p_dados->>'ano_max','')::int,
      NULLIF(p_dados->>'valor_ate','')::numeric, NULLIF(btrim(p_dados->>'cambio'),''),
      NULLIF(btrim(p_dados->>'observacao'),''), p_user)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'procura_id', v_id);
END $function$;

-- ------------------------------------------------------------
-- 3.4 · demanda nao atendida — o que comprar. Agrupa procura em aberto por marca+modelo normalizados.
--       <2 procuras do mesmo modelo NAO afirma demanda (caso isolado) — igual sugestao de gasto / estatisticas.
--       Normalizacao: lower + trim + colapso de espacos (tela mostra o texto original).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_demanda_nao_atendida(p_company_id uuid, p_dias int DEFAULT 90)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  WITH base AS (
    SELECT
      regexp_replace(lower(btrim(coalesce(pr.marca,''))), '\s+', ' ', 'g')  AS marca_norm,
      regexp_replace(lower(btrim(coalesce(pr.modelo,''))), '\s+', ' ', 'g') AS modelo_norm,
      pr.marca, pr.modelo, pr.ano_min, pr.ano_max, pr.valor_ate
    FROM veic_procura pr
    WHERE pr.company_id = p_company_id AND pr.atendida_em IS NULL
      AND pr.criado_em >= now() - make_interval(days => p_dias)
      AND (coalesce(btrim(pr.marca),'') <> '' OR coalesce(btrim(pr.modelo),'') <> '')
  ),
  grp AS (
    SELECT marca_norm, modelo_norm,
      count(*) AS procuras,
      mode() WITHIN GROUP (ORDER BY marca)  AS marca_txt,
      mode() WITHIN GROUP (ORDER BY modelo) AS modelo_txt,
      min(ano_min) AS ano_min, max(ano_max) AS ano_max, max(valor_ate) AS valor_ate
    FROM base GROUP BY marca_norm, modelo_norm
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'marca', g.marca_txt, 'modelo', g.modelo_txt,
    'procuras', g.procuras,
    'demanda', g.procuras >= 2,
    'ano_min', g.ano_min, 'ano_max', g.ano_max, 'valor_ate', g.valor_ate,
    'estoque_qtd', est.qtd,
    'estoque_preco_min', est.preco_min
  ) ORDER BY g.procuras DESC, g.modelo_txt), '[]'::jsonb) INTO v
  FROM grp g
  CROSS JOIN LATERAL (
    SELECT count(*) AS qtd, min(vv.preco_venda) FILTER (WHERE vv.preco_venda IS NOT NULL) AS preco_min
    FROM veic_veiculo vv
    WHERE vv.company_id = p_company_id AND vv.deleted_at IS NULL AND vv.ativo IS DISTINCT FROM false
      AND vv.situacao NOT IN ('vendido','entregue','devolvido')
      AND (g.modelo_norm = '' OR regexp_replace(lower(btrim(coalesce(vv.modelo,''))), '\s+', ' ', 'g') LIKE '%' || g.modelo_norm || '%')
      AND (g.marca_norm = ''  OR regexp_replace(lower(btrim(coalesce(vv.marca,''))),  '\s+', ' ', 'g') = g.marca_norm)
  ) est;

  RETURN jsonb_build_object('ok', true, 'dias', p_dias, 'itens', v);
END $function$;
