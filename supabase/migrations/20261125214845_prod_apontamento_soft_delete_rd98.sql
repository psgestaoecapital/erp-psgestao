-- RD-98 p4 (exclusão rastreável): prod_apontamento_hora passa a ter SOFT-DELETE.
-- Antes: fn_prod_apontamento_excluir fazia DELETE FÍSICO (gravava o antigo em audit_log_global,
-- mas apagava a linha). RD-98 exige soft-delete + listagem que filtra os excluídos, nunca DELETE físico.
--
-- O que muda:
--  1. Colunas excluido_em / excluido_por (quem e quando excluiu). Aditivas.
--  2. A unicidade (empresa, fluxo, posto, produto, data, hora) passa a valer SÓ para as linhas VIVAS
--     (índice parcial WHERE excluido_em IS NULL) — assim o usuário pode RE-LANÇAR o mesmo
--     posto/produto/data/hora depois de excluir, como acontecia com o DELETE físico.
--  3. fn_prod_apontamento_excluir marca excluido_em/excluido_por (idempotente) em vez de apagar.
--  4. fn_prod_apontar_hora: ON CONFLICT passa a mirar o índice parcial (WHERE excluido_em IS NULL).
--  5. Leituras/agregações (listar, produtividade_hora, rateio_admin, rendimento_comparativo) passam a
--     ignorar as linhas excluídas — para que um apontamento excluído não conte mais em produtividade/custo
--     (preserva o efeito do antigo DELETE físico).
--
-- Área: Indústria › Produtividade (NÃO é núcleo financeiro de cliente). RLS inalterada; não toca dado de cliente.
-- RD-94.1: CREATE OR REPLACE de funções existentes é SENSÍVEL -> label revisao-eng-chefe.
-- RD-38: prod_apontamento_hora = 0 linhas em produção; prova funcional (excluir + re-lançar + agregação) em
--        transação BEGIN/ROLLBACK anexada ao PR. Code: desenvolvedor_4_g

-- 1. Marcadores de soft-delete (aditivos)
ALTER TABLE public.prod_apontamento_hora
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- 2. Unicidade só entre linhas vivas (permite re-lançar a mesma chave após excluir)
ALTER TABLE public.prod_apontamento_hora
  DROP CONSTRAINT IF EXISTS prod_apontamento_hora_company_id_fluxo_id_posto_id_produto__key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_apontamento_hora_vivo
  ON public.prod_apontamento_hora (company_id, fluxo_id, posto_id, produto_id, data, hora)
  NULLS NOT DISTINCT
  WHERE excluido_em IS NULL;

-- 3. Exclusão = soft-delete rastreável (mantém o rastro em audit_log_global)
CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_excluir(p_company_id uuid, p_plant_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.prod_apontamento_hora%ROWTYPE;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT * INTO v_row FROM public.prod_apontamento_hora
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;
  IF v_row.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', p_id);  -- já excluído: idempotente
  END IF;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior)
  VALUES (p_company_id, auth.uid(), 'prod_apontamento_hora', p_id::text, 'delete', to_jsonb(v_row));

  UPDATE public.prod_apontamento_hora
     SET excluido_em = now(), excluido_por = auth.uid(), updated_at = now()
   WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

-- 4. Upsert mira o índice parcial das linhas vivas
CREATE OR REPLACE FUNCTION public.fn_prod_apontar_hora(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_produto_id uuid, p_data date, p_hora integer, p_qtd_produzida numeric, p_posto_id uuid DEFAULT NULL::uuid, p_etapa_id uuid DEFAULT NULL::uuid, p_tarefa_id uuid DEFAULT NULL::uuid, p_unidade text DEFAULT NULL::text, p_pessoas_presentes integer DEFAULT NULL::integer, p_fonte text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_hora IS NULL OR p_hora < 0 OR p_hora > 23 THEN RAISE EXCEPTION 'hora_invalida'; END IF;
  IF p_qtd_produzida IS NULL OR p_qtd_produzida < 0 THEN RAISE EXCEPTION 'qtd_invalida'; END IF;
  IF coalesce(p_fonte,'manual') NOT IN ('manual','ponto','balanca') THEN RAISE EXCEPTION 'fonte_invalida'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_fluxo f WHERE f.id = p_fluxo_id AND f.company_id = p_company_id AND f.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'fluxo_nao_encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prod_produto p WHERE p.id = p_produto_id AND p.company_id = p_company_id AND p.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
  -- Validar as FKs opcionais contra a mesma empresa/planta (e a etapa contra o fluxo) quando informadas,
  -- para não aceitar referência cruzada de outra empresa.
  IF p_posto_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_posto po WHERE po.id = p_posto_id AND po.company_id = p_company_id AND po.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'posto_nao_encontrado'; END IF;
  IF p_etapa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_fluxo_etapa e WHERE e.id = p_etapa_id AND e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.fluxo_id = p_fluxo_id)
  THEN RAISE EXCEPTION 'etapa_nao_encontrada'; END IF;
  IF p_tarefa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.prod_tarefa t WHERE t.id = p_tarefa_id AND t.company_id = p_company_id AND t.plant_id = p_plant_id)
  THEN RAISE EXCEPTION 'tarefa_nao_encontrada'; END IF;
  INSERT INTO public.prod_apontamento_hora (company_id, plant_id, fluxo_id, etapa_id, tarefa_id, posto_id, produto_id,
      data, hora, qtd_produzida, unidade, pessoas_presentes, fonte, criado_por)
  VALUES (p_company_id, p_plant_id, p_fluxo_id, p_etapa_id, p_tarefa_id, p_posto_id, p_produto_id,
      p_data, p_hora, p_qtd_produzida, p_unidade, p_pessoas_presentes, coalesce(p_fonte,'manual'), auth.uid())
  ON CONFLICT (company_id, fluxo_id, posto_id, produto_id, data, hora) WHERE excluido_em IS NULL DO UPDATE SET
      etapa_id = EXCLUDED.etapa_id, tarefa_id = EXCLUDED.tarefa_id, qtd_produzida = EXCLUDED.qtd_produzida,
      unidade = EXCLUDED.unidade, pessoas_presentes = EXCLUDED.pessoas_presentes, fonte = EXCLUDED.fonte,
      updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- 5a. Listagem ignora excluídos
CREATE OR REPLACE FUNCTION public.fn_prod_apontamento_listar(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'posto_id', a.posto_id, 'posto_numero', po.numero, 'posto_atividade', po.atividade,
           'produto_id', a.produto_id, 'produto_codigo', pr.codigo, 'produto_nome', pr.nome,
           'hora', a.hora, 'qtd_produzida', a.qtd_produzida, 'unidade', a.unidade,
           'pessoas_presentes', a.pessoas_presentes, 'fonte', a.fonte
         ) ORDER BY po.numero NULLS LAST, a.hora, pr.codigo), '[]'::jsonb) INTO v
    FROM public.prod_apontamento_hora a
    LEFT JOIN public.prod_posto po ON po.id = a.posto_id
    LEFT JOIN public.prod_produto pr ON pr.id = a.produto_id
   WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id AND a.data = p_data
     AND a.excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'lancamentos', v);
END $function$;

-- 5b. Produtividade por hora ignora excluídos
CREATE OR REPLACE FUNCTION public.fn_prod_produtividade_hora(p_company_id uuid, p_plant_id uuid, p_fluxo_id uuid, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(linha ORDER BY linha->>'posto_numero', (linha->>'hora')::int), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'posto_id', a.posto_id,
      'posto_numero', po.numero,
      'hora', a.hora,
      'produzido', SUM(a.qtd_produzida),
      'capacidade', po.capacidade_hora,
      'produtividade_pct', CASE WHEN po.capacidade_hora IS NULL OR po.capacidade_hora = 0 THEN NULL
                                ELSE round((SUM(a.qtd_produzida) / po.capacidade_hora) * 100, 1) END,
      'ociosidade_pct', CASE WHEN po.capacidade_hora IS NULL OR po.capacidade_hora = 0 THEN NULL
                             ELSE greatest(0, round((1 - SUM(a.qtd_produzida) / po.capacidade_hora) * 100, 1)) END,
      'pessoas_presentes', MAX(a.pessoas_presentes)
    ) AS linha
    FROM public.prod_apontamento_hora a
    LEFT JOIN public.prod_posto po ON po.id = a.posto_id
    WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id AND a.fluxo_id = p_fluxo_id AND a.data = p_data
      AND a.excluido_em IS NULL
    GROUP BY a.posto_id, po.numero, po.capacidade_hora, a.hora
  ) s;
  RETURN jsonb_build_object('ok', true, 'data', p_data, 'postos', v);
END $function$;

-- 5c. Rateio admin: o "kg" apontado do mês ignora excluídos
CREATE OR REPLACE FUNCTION public.fn_prod_rateio_admin_distribuir(p_company_id uuid, p_plant_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp date := date_trunc('month', coalesce(p_competencia, current_date))::date;
  v_ini date; v_fim date; v_base numeric := 0; v_crit text := 'horas_mo';
  v_den numeric; v_rows jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  v_ini := v_comp; v_fim := (v_comp + interval '1 month')::date;

  SELECT r.base_valor, r.criterio INTO v_base, v_crit
  FROM public.prod_rateio_admin r
  WHERE r.company_id = p_company_id AND r.plant_id = p_plant_id AND r.competencia = v_comp;
  v_base := coalesce(v_base, 0); v_crit := coalesce(v_crit, 'horas_mo');

  WITH posto AS (
    SELECT po.id, po.numero, po.atividade, po.setor_id
    FROM public.prod_posto po
    WHERE po.company_id = p_company_id AND po.plant_id = p_plant_id AND po.ativo
  ),
  horas AS (  -- horas de operação vigentes no mês (custo mais recente até a competência)
    SELECT DISTINCT ON (pc.posto_id) pc.posto_id, pc.horas_operacao_mes
    FROM public.prod_posto_custo pc
    WHERE pc.company_id = p_company_id AND pc.plant_id = p_plant_id AND pc.deleted_at IS NULL
      AND pc.vigencia_inicio <= v_fim
    ORDER BY pc.posto_id, pc.vigencia_inicio DESC, pc.created_at DESC
  ),
  pes AS (  -- pessoas alocadas no posto no mês
    SELECT pp.posto_id, count(*)::numeric AS n
    FROM public.prod_posto_pessoa pp
    WHERE pp.company_id = p_company_id AND pp.plant_id = p_plant_id
      AND pp.vigencia_inicio <= v_fim AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim >= v_ini)
    GROUP BY pp.posto_id
  ),
  kg AS (  -- produzido apontado no mês (ignora apontamentos excluídos)
    SELECT a.posto_id, sum(a.qtd_produzida)::numeric AS kg
    FROM public.prod_apontamento_hora a
    WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id
      AND a.data >= v_ini AND a.data < v_fim AND a.posto_id IS NOT NULL
      AND a.excluido_em IS NULL
    GROUP BY a.posto_id
  ),
  base AS (
    SELECT p.id, p.numero, p.atividade,
           coalesce(h.horas_operacao_mes, 0)::numeric AS horas,
           coalesce(pe.n, 0)::numeric AS pessoas,
           coalesce(k.kg, 0)::numeric AS kg,
           CASE v_crit
             WHEN 'horas_mo' THEN coalesce(pe.n,0) * coalesce(h.horas_operacao_mes,0)
             WHEN 'kg'       THEN coalesce(k.kg,0)
             WHEN 'pessoas'  THEN coalesce(pe.n,0)
             ELSE 0 END AS peso
    FROM posto p
    LEFT JOIN horas h ON h.posto_id = p.id
    LEFT JOIN pes   pe ON pe.posto_id = p.id
    LEFT JOIN kg    k ON k.posto_id = p.id
  ),
  tot AS (SELECT sum(peso) AS den FROM base)
  SELECT (SELECT den FROM tot),
         coalesce(jsonb_agg(jsonb_build_object(
           'posto_id', b.id, 'posto_numero', b.numero, 'posto_atividade', b.atividade,
           'horas_operacao_mes', NULLIF(b.horas,0), 'pessoas', b.pessoas, 'kg', b.kg,
           'peso', b.peso,
           'rateio_rs_mes', CASE WHEN coalesce((SELECT den FROM tot),0) > 0
                                 THEN round(v_base * b.peso / (SELECT den FROM tot), 2) ELSE 0 END,
           'rateio_rs_hora', CASE WHEN coalesce((SELECT den FROM tot),0) > 0 AND b.horas > 0
                                  THEN round((v_base * b.peso / (SELECT den FROM tot)) / b.horas, 4) END
         ) ORDER BY b.numero), '[]'::jsonb)
    INTO v_den, v_rows FROM base b;

  RETURN jsonb_build_object(
    'ok', true, 'competencia', v_comp, 'base_valor', v_base, 'criterio', v_crit,
    'total_peso', coalesce(v_den, 0), 'postos', v_rows,
    'aviso', CASE
      WHEN v_base = 0 THEN 'base_zerada'
      WHEN coalesce(v_den,0) = 0 THEN 'sem_peso'  -- o critério escolhido não tem dado em nenhum posto do mês
      ELSE NULL END);
END $function$;

-- 5d. Rendimento comparativo: o kg real apontado ignora excluídos
CREATE OR REPLACE FUNCTION public.fn_prod_rendimento_comparativo(p_company_id uuid, p_plant_id uuid, p_data_ini date, p_data_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_origens jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_data_ini IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_ini THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'periodo_invalido');
  END IF;

  WITH real_kg AS (  -- kg real por produto no período (produção apontada, ignora excluídos)
    SELECT a.produto_id, sum(a.qtd_produzida)::numeric AS kg
      FROM public.prod_apontamento_hora a
     WHERE a.company_id = p_company_id AND a.plant_id = p_plant_id
       AND a.data >= p_data_ini AND a.data <= p_data_fim
       AND a.excluido_em IS NULL
     GROUP BY a.produto_id
  ),
  est AS (  -- padrão: cada origem e suas saídas (estrutura ativa)
    SELECT e.origem_produto_id, e.produto_id, e.tipo_saida, e.rendimento_padrao_pct,
           po.codigo AS origem_codigo, po.nome AS origem_nome,
           ps.codigo AS saida_codigo, ps.nome AS saida_nome, ps.preco_venda_ref AS preco
      FROM public.prod_estrutura e
      JOIN public.prod_produto po ON po.id = e.origem_produto_id
      JOIN public.prod_produto ps ON ps.id = e.produto_id
     WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.ativo
  ),
  linhas AS (
    SELECT est.*,
           COALESCE(ro.kg, 0)::numeric AS origem_kg,
           COALESCE(rs.kg, 0)::numeric AS saida_kg,
           (ro.kg IS NOT NULL AND ro.kg > 0) AS tem_origem
      FROM est
      LEFT JOIN real_kg ro ON ro.produto_id = est.origem_produto_id
      LEFT JOIN real_kg rs ON rs.produto_id = est.produto_id
  ),
  por_saida AS (
    SELECT l.origem_produto_id, l.origem_codigo, l.origem_nome, l.origem_kg, l.tem_origem,
      l.rendimento_padrao_pct AS padrao_pct,
      CASE WHEN l.tem_origem THEN l.saida_kg / l.origem_kg * 100.0 END AS real_pct_v,
      jsonb_build_object(
        'produto_id',  l.produto_id,
        'codigo',      l.saida_codigo,
        'nome',        l.saida_nome,
        'tipo_saida',  l.tipo_saida,
        'padrao_pct',  l.rendimento_padrao_pct,
        'esperado_kg', CASE WHEN l.tem_origem THEN round(l.origem_kg * COALESCE(l.rendimento_padrao_pct,0)/100.0, 2) END,
        'real_kg',     CASE WHEN l.tem_origem THEN round(l.saida_kg, 2) END,
        'real_pct',    CASE WHEN l.tem_origem THEN round(l.saida_kg / l.origem_kg * 100.0, 2) END,
        'diff_pct',    CASE WHEN l.tem_origem AND l.rendimento_padrao_pct IS NOT NULL
                            THEN round(l.saida_kg / l.origem_kg * 100.0 - l.rendimento_padrao_pct, 2) END,
        'diff_kg',     CASE WHEN l.tem_origem
                            THEN round(l.saida_kg - l.origem_kg * COALESCE(l.rendimento_padrao_pct,0)/100.0, 2) END,
        'preco_ref',   l.preco,
        'diff_rs',     CASE WHEN l.tem_origem AND l.preco IS NOT NULL
                            THEN round((l.saida_kg - l.origem_kg * COALESCE(l.rendimento_padrao_pct,0)/100.0) * l.preco, 2) END
      ) AS saida
    FROM linhas l
  ),
  agrup AS (
    SELECT origem_produto_id,
           max(origem_codigo) AS origem_codigo,
           max(origem_nome)   AS origem_nome,
           max(origem_kg)     AS origem_kg,
           bool_or(tem_origem) AS tem_origem,
           sum(padrao_pct)    AS soma_padrao,
           CASE WHEN bool_or(tem_origem) THEN sum(real_pct_v) END AS soma_real,
           jsonb_agg(saida ORDER BY (saida->>'tipo_saida'), (saida->>'codigo')) AS saidas
      FROM por_saida
     GROUP BY origem_produto_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'origem_produto_id', origem_produto_id,
           'origem_codigo',     origem_codigo,
           'origem_nome',       origem_nome,
           'origem_kg',         CASE WHEN tem_origem THEN round(origem_kg, 2) END,
           'tem_real',          tem_origem,
           'soma_padrao_pct',   round(soma_padrao, 2),
           'soma_real_pct',     round(soma_real, 2),
           'soma_fora_100',     (soma_padrao IS NOT NULL AND (soma_padrao < 97 OR soma_padrao > 103)),
           'saidas',            saidas
         ) ORDER BY origem_codigo), '[]'::jsonb) INTO v_origens
    FROM agrup;

  RETURN jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('ini', p_data_ini, 'fim', p_data_fim),
    'origens', v_origens
  );
END $function$;

-- Guarda de acesso (RD): mantém o REVOKE anon / GRANT autenticado das funções tocadas.
REVOKE ALL ON FUNCTION public.fn_prod_apontamento_excluir(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_prod_apontar_hora(uuid, uuid, uuid, uuid, date, integer, numeric, uuid, uuid, uuid, text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_prod_apontamento_listar(uuid, uuid, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.fn_prod_produtividade_hora(uuid, uuid, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.fn_prod_rateio_admin_distribuir(uuid, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.fn_prod_rendimento_comparativo(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontamento_excluir(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontar_hora(uuid, uuid, uuid, uuid, date, integer, numeric, uuid, uuid, uuid, text, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_apontamento_listar(uuid, uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_produtividade_hora(uuid, uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_rateio_admin_distribuir(uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_prod_rendimento_comparativo(uuid, uuid, date, date) TO authenticated, service_role;
