-- ============================================================
-- ONDA 7 · Painel do dono (/dashboard/revenda) + alerta de especie (COAF)
-- So leitura agregada do que JA existe; nenhuma regra de negocio muda. O painel diz o que NAO
-- mede (carrego/coaf/encargos) em vez de fingir completude (RD-51/58) — sem carrego, "capital
-- parado" nao e "lucro".
--
-- COAF (setor obrigado): o sistema DETECTA e REGISTRA; NAO comunica ao SISCOAF (ato do obrigado).
--   - O limite NUNCA fica no codigo: e norma, com vigencia, por empresa (veic_coaf_parametro).
--     Sem parametro => limite_nao_configurado; NAO assume valor nenhum (chute e pior que nada).
--   - fn_veic_coaf_avaliar SOMA toda a especie da MESMA venda: fracionar em varios recebimentos
--     menores nao escapa (fracionamento e justamente o padrao que a norma persegue).
--   - forma_padrao NULL (recebimento antigo) = nao_classificado; a fila mostra separado — nunca
--     tratado como "nao e especie".
-- Pendencias fiscais reusam a MESMA logica da tela de completar (fn_veic_completude_resumo).
-- ============================================================

-- ------------------------------------------------------------
-- COAF · forma de pagamento normalizada (dominio fechado). forma_pagamento segue texto livre.
-- ------------------------------------------------------------
ALTER TABLE public.veic_venda_recebimento ADD COLUMN IF NOT EXISTS forma_padrao text;
COMMENT ON COLUMN public.veic_venda_recebimento.forma_padrao IS
  'Forma normalizada: especie | pix | transferencia | cheque | cartao | financiamento | outro. '
  'NULL = nao classificado (recebimentos antigos). forma_pagamento segue como texto livre do usuario.';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='veic_receb_forma_padrao_chk') THEN
    ALTER TABLE public.veic_venda_recebimento
      ADD CONSTRAINT veic_receb_forma_padrao_chk CHECK (forma_padrao IS NULL OR forma_padrao IN
        ('especie','pix','transferencia','cheque','cartao','financiamento','outro'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- COAF · parametros legais por empresa, COM VIGENCIA (o limite muda por norma)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.veic_coaf_parametro (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  vigencia_inicio date NOT NULL,
  limite_especie  numeric NOT NULL,
  observacao      text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid
);
CREATE INDEX IF NOT EXISTS ix_veic_coaf_parametro_comp
  ON public.veic_coaf_parametro(company_id, vigencia_inicio DESC);

-- ------------------------------------------------------------
-- COAF · registro do que foi detectado e do que foi comunicado (uma ocorrencia por venda)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.veic_coaf_ocorrencia (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  venda_id        uuid REFERENCES public.veic_venda(id) ON DELETE SET NULL,
  valor_especie   numeric NOT NULL,
  limite_aplicado numeric NOT NULL,
  detectado_em    timestamptz NOT NULL DEFAULT now(),
  situacao        text NOT NULL DEFAULT 'pendente',
  comunicado_em   timestamptz,
  protocolo       text,
  observacao      text,
  CONSTRAINT veic_coaf_situacao_chk CHECK (situacao IN ('pendente','comunicado','dispensado'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_veic_coaf_ocorrencia_venda
  ON public.veic_coaf_ocorrencia(venda_id) WHERE venda_id IS NOT NULL;

-- RLS nas duas tabelas (padrao veic_*: company do usuario ou admin)
ALTER TABLE public.veic_coaf_parametro  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.veic_coaf_ocorrencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS veic_coaf_parametro_rw  ON public.veic_coaf_parametro;
DROP POLICY IF EXISTS veic_coaf_ocorrencia_rw ON public.veic_coaf_ocorrencia;
CREATE POLICY veic_coaf_parametro_rw ON public.veic_coaf_parametro FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY veic_coaf_ocorrencia_rw ON public.veic_coaf_ocorrencia FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- ------------------------------------------------------------
-- fn_veic_coaf_limite · limite de especie vigente na data (maior vigencia <= data). NULL = nao configurado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_coaf_limite(p_company_id uuid, p_data date)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT limite_especie FROM veic_coaf_parametro
   WHERE company_id = p_company_id AND vigencia_inicio <= p_data
   ORDER BY vigencia_inicio DESC LIMIT 1;
$function$;

-- ------------------------------------------------------------
-- fn_veic_coaf_avaliar · SOMA toda a especie da venda e compara ao limite vigente na data da venda.
--   Sem limite => limite_nao_configurado (nao assume valor). Acima => UPSERT de ocorrencia (idempotente
--   por venda: fracionar nao gera N ocorrencias, e reavaliar nao duplica). E o detector (write-path).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_coaf_avaliar(p_venda_id uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_data date; v_lim numeric; v_esp numeric; v_naoclass numeric; v_oc uuid; v_sit text;
BEGIN
  SELECT company_id, data_venda INTO v_comp, v_data
    FROM veic_venda WHERE id = p_venda_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'venda_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT coalesce(sum(valor) FILTER (WHERE forma_padrao = 'especie'), 0),
         coalesce(sum(valor) FILTER (WHERE forma_padrao IS NULL), 0)
    INTO v_esp, v_naoclass
    FROM veic_venda_recebimento WHERE venda_id = p_venda_id;

  v_lim := fn_veic_coaf_limite(v_comp, coalesce(v_data, CURRENT_DATE));
  IF v_lim IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 'limite_nao_configurado',
      'valor_especie', v_esp, 'nao_classificado', v_naoclass);
  END IF;

  IF v_esp > v_lim THEN
    INSERT INTO veic_coaf_ocorrencia (company_id, venda_id, valor_especie, limite_aplicado)
    VALUES (v_comp, p_venda_id, v_esp, v_lim)
    ON CONFLICT (venda_id) WHERE venda_id IS NOT NULL
    DO UPDATE SET valor_especie = EXCLUDED.valor_especie, limite_aplicado = EXCLUDED.limite_aplicado,
                  detectado_em = now()
    RETURNING id, situacao INTO v_oc, v_sit;
    RETURN jsonb_build_object('ok', true, 'status', 'acima', 'acima', true,
      'valor_especie', v_esp, 'nao_classificado', v_naoclass, 'limite', v_lim,
      'ocorrencia_id', v_oc, 'situacao', v_sit);
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'dentro', 'acima', false,
    'valor_especie', v_esp, 'nao_classificado', v_naoclass, 'limite', v_lim);
END $function$;

-- ------------------------------------------------------------
-- fn_veic_coaf_pendentes · fila do painel. DETECCAO AO VIVO (STABLE, nao escreve): soma toda a especie
--   por venda vs limite vigente na data da venda — assim o painel nunca perde uma exposicao so porque
--   ninguem chamou avaliar. Junta a ocorrencia persistida (id p/ marcar, situacao). pendente = acima e
--   nao comunicado/dispensado. Reporta nao_classificado a parte. limite_configurado = existe parametro.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_coaf_pendentes(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_has_param boolean; v_lim_hoje numeric; v_ocs jsonb; v_naoclass jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  SELECT EXISTS(SELECT 1 FROM veic_coaf_parametro WHERE company_id = p_company_id) INTO v_has_param;
  v_lim_hoje := fn_veic_coaf_limite(p_company_id, CURRENT_DATE);

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'valor_especie')::numeric DESC), '[]'::jsonb) INTO v_ocs FROM (
    SELECT jsonb_build_object(
      'venda_id', vv.id, 'numero', vv.numero, 'cliente_nome', vv.cliente_nome,
      'valor_especie', esp.v, 'limite_aplicado', lim.l,
      'ocorrencia_id', oc.id, 'situacao', COALESCE(oc.situacao, 'pendente'),
      'protocolo', oc.protocolo, 'comunicado_em', oc.comunicado_em
    ) AS x
    FROM veic_venda vv
    JOIN LATERAL (SELECT coalesce(sum(valor) FILTER (WHERE forma_padrao = 'especie'), 0) AS v
                    FROM veic_venda_recebimento r WHERE r.venda_id = vv.id) esp ON true
    JOIN LATERAL (SELECT fn_veic_coaf_limite(vv.company_id, coalesce(vv.data_venda, CURRENT_DATE)) AS l) lim ON true
    LEFT JOIN veic_coaf_ocorrencia oc ON oc.venda_id = vv.id
    WHERE vv.company_id = p_company_id AND vv.deleted_at IS NULL AND vv.situacao <> 'cancelada'
      AND lim.l IS NOT NULL AND esp.v > lim.l
      AND COALESCE(oc.situacao, 'pendente') = 'pendente'
  ) t;

  SELECT jsonb_build_object('recebimentos', count(*), 'valor', coalesce(sum(r.valor), 0))
    INTO v_naoclass
    FROM veic_venda_recebimento r JOIN veic_venda vv ON vv.id = r.venda_id
   WHERE vv.company_id = p_company_id AND vv.deleted_at IS NULL AND r.forma_padrao IS NULL;

  RETURN jsonb_build_object('ok', true,
    'limite_configurado', v_has_param,
    'limite_vigente', v_lim_hoje,
    'ocorrencias', v_ocs,
    'pendentes', jsonb_array_length(v_ocs),
    'nao_classificado', v_naoclass);
END $function$;

-- ------------------------------------------------------------
-- fn_veic_coaf_marcar · marca a ocorrencia como comunicado (com protocolo) ou dispensado. NAO comunica
--   ao SISCOAF — so registra o ato do obrigado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_coaf_marcar(p_ocorrencia_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_sit text;
BEGIN
  SELECT company_id INTO v_comp FROM veic_coaf_ocorrencia WHERE id = p_ocorrencia_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'ocorrencia_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  v_sit := coalesce(p_dados->>'situacao', 'comunicado');
  IF v_sit NOT IN ('comunicado','dispensado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'situacao_invalida'); END IF;

  UPDATE veic_coaf_ocorrencia
     SET situacao      = v_sit,
         comunicado_em = CASE WHEN v_sit = 'comunicado' THEN now() ELSE comunicado_em END,
         protocolo     = coalesce(p_dados->>'protocolo', protocolo),
         observacao    = coalesce(p_dados->>'observacao', observacao)
   WHERE id = p_ocorrencia_id;
  RETURN jsonb_build_object('ok', true, 'situacao', v_sit);
END $function$;

-- ------------------------------------------------------------
-- fn_veic_painel · uma chamada, tudo agregado. Guard de tenant no padrao veic_*. STABLE (nao escreve).
--   'config' expoe o que NAO esta configurado (carrego/coaf/encargos) — o painel diz o que nao mede.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_veic_painel(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_g int; v_a int; v_t int;
  v_cap numeric; v_custos numeric; v_tot int;
  v_vend_mes int; v_vend_tot int; v_dias_medio numeric;
  v_sem_preco int; v_sem_vist int; v_sem_foto int; v_sem_custo int; v_ent_sem_nota int; v_falta_nota int;
  v_semaforo jsonb; v_marcas jsonb; v_conc jsonb; v_coaf jsonb;
  v_has_config boolean; v_has_encargos boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  -- faixas do semaforo (veic_config; default 30/60). terceiro corte = amarelo + (amarelo - verde) => 90.
  SELECT semaforo_verde_ate_dias, semaforo_amarelo_ate_dias INTO v_g, v_a
    FROM veic_config WHERE company_id = p_company_id;
  v_g := coalesce(v_g, 30); v_a := coalesce(v_a, 60); v_t := v_a + (v_a - v_g);
  SELECT (count(*) > 0) INTO v_has_config FROM veic_config WHERE company_id = p_company_id;
  SELECT coalesce(bool_or(impostos_venda_pct IS NOT NULL), false) INTO v_has_encargos
    FROM veic_config WHERE company_id = p_company_id;

  -- capital no patio = aquisicao + custos lancados (nao-deletados). Bate com fn_veic_patio_resumo.
  SELECT count(*), coalesce(sum(valor_aquisicao), 0) INTO v_tot, v_cap
    FROM veic_veiculo WHERE company_id = p_company_id AND deleted_at IS NULL;
  SELECT coalesce(sum(c.valor), 0) INTO v_custos
    FROM veic_custo c JOIN veic_veiculo v ON v.id = c.veiculo_id
   WHERE v.company_id = p_company_id AND v.deleted_at IS NULL AND c.deleted_at IS NULL;
  v_cap := v_cap + v_custos;

  -- giro: vendidos no mes (data_venda no mes corrente) + total de vendas e dias medios em estoque
  SELECT count(*) FILTER (WHERE data_venda >= date_trunc('month', CURRENT_DATE)) INTO v_vend_mes
    FROM veic_venda WHERE company_id = p_company_id AND deleted_at IS NULL AND situacao <> 'cancelada';
  SELECT count(*), round(avg(vv.data_venda - v.data_entrada::date)) INTO v_vend_tot, v_dias_medio
    FROM veic_venda vv JOIN veic_veiculo v ON v.id = vv.veiculo_id
   WHERE vv.company_id = p_company_id AND vv.deleted_at IS NULL AND vv.situacao <> 'cancelada'
     AND vv.data_venda IS NOT NULL AND v.data_entrada IS NOT NULL;

  -- semaforo em dinheiro: 4 faixas por dias no patio (data_entrada); numero E capital de cada faixa.
  WITH veic AS (
    SELECT valor_aquisicao, (CURRENT_DATE - coalesce(data_entrada::date, CURRENT_DATE)) AS dias
      FROM veic_veiculo WHERE company_id = p_company_id AND deleted_at IS NULL
  ), b AS (
    SELECT valor_aquisicao,
           CASE WHEN dias <= v_g THEN 1 WHEN dias <= v_a THEN 2 WHEN dias <= v_t THEN 3 ELSE 4 END AS ord
      FROM veic
  )
  SELECT jsonb_agg(jsonb_build_object('ord', o.ord, 'faixa', o.faixa, 'veiculos', s.n, 'capital', s.cap) ORDER BY o.ord)
    INTO v_semaforo
  FROM (VALUES
    (1, '0-'||v_g||' dias'), (2, v_g||'-'||v_a||' dias'), (3, v_a||'-'||v_t||' dias'), (4, '+'||v_t||' dias')
  ) o(ord, faixa)
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, coalesce(sum(valor_aquisicao), 0) AS cap FROM b WHERE b.ord = o.ord
  ) s ON true;

  -- pendencias (numeros que a fila do painel abre no patio ja filtrado)
  SELECT count(*) INTO v_sem_preco FROM veic_veiculo
   WHERE company_id = p_company_id AND deleted_at IS NULL AND preco_venda IS NULL;
  SELECT count(*) INTO v_sem_foto FROM veic_veiculo
   WHERE company_id = p_company_id AND deleted_at IS NULL AND (foto_url IS NULL OR btrim(foto_url) = '');
  SELECT count(*) INTO v_sem_custo FROM veic_veiculo v
   WHERE v.company_id = p_company_id AND v.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM veic_custo c WHERE c.veiculo_id = v.id AND c.deleted_at IS NULL);
  SELECT count(*) INTO v_sem_vist FROM veic_veiculo v
   WHERE v.company_id = p_company_id AND v.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM insp_vistoria vi
                      WHERE vi.alvo_tabela = 'veic_veiculo' AND vi.alvo_id = v.id AND vi.situacao <> 'cancelada');
  SELECT count(*) INTO v_ent_sem_nota FROM veic_venda
   WHERE company_id = p_company_id AND deleted_at IS NULL AND situacao = 'entregue' AND nfe_id IS NULL;
  -- faltam campos p/ nota: MESMA logica fiscal da tela de completar (nao reinventa)
  SELECT coalesce((fn_veic_completude_resumo(p_company_id)->>'pendentes')::int, 0) INTO v_falta_nota;

  -- concentracao de capital · por marca (LITERAL, como fn_veic_patio_resumo)
  SELECT jsonb_agg(jsonb_build_object('nome', nome, 'n', n, 'capital', cap) ORDER BY cap DESC, nome) INTO v_marcas FROM (
    SELECT CASE WHEN norm = '' THEN 'sem marca' ELSE mode() WITHIN GROUP (ORDER BY marca) END AS nome,
           count(*) AS n, coalesce(sum(valor_aquisicao), 0) AS cap
    FROM (SELECT marca, valor_aquisicao, upper(unaccent(btrim(coalesce(marca, '')))) AS norm
            FROM veic_veiculo WHERE company_id = p_company_id AND deleted_at IS NULL) z
    GROUP BY norm
  ) m;

  -- veiculo unico que passa de 15% do capital do patio (aquisicao + custos do proprio chassi)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('veiculo_id', id, 'placa', placa, 'modelo', modelo,
           'valor', val, 'pct', round(100.0 * val / NULLIF(v_cap, 0))) ORDER BY val DESC), '[]'::jsonb) INTO v_conc
  FROM (
    SELECT v.id, v.placa, v.modelo,
      (coalesce(v.valor_aquisicao, 0)
       + coalesce((SELECT sum(c.valor) FROM veic_custo c WHERE c.veiculo_id = v.id AND c.deleted_at IS NULL), 0)) AS val
    FROM veic_veiculo v WHERE v.company_id = p_company_id AND v.deleted_at IS NULL
  ) z
  WHERE v_cap > 0 AND val > 0.15 * v_cap;

  v_coaf := fn_veic_coaf_pendentes(p_company_id);

  RETURN jsonb_build_object('ok', true,
    'capital', v_cap,
    'veiculos', jsonb_build_object('total', v_tot, 'vendidos_mes', v_vend_mes),
    'giro', jsonb_build_object('vendas', v_vend_tot, 'dias_medio', v_dias_medio),
    'semaforo', coalesce(v_semaforo, '[]'::jsonb),
    'pendencias', jsonb_build_object(
       'entregue_sem_nota', v_ent_sem_nota,
       'sem_preco', v_sem_preco,
       'sem_vistoria', v_sem_vist,
       'sem_foto', v_sem_foto,
       'sem_custo', v_sem_custo,
       'faltam_nota', v_falta_nota),
    'marcas', coalesce(v_marcas, '[]'::jsonb),
    'concentracao', v_conc,
    'coaf', v_coaf,
    -- carrego: depende do plano de contas + Ondas 3/4; NAO implementado hoje => sempre false (verdade).
    'config', jsonb_build_object('carrego', false, 'coaf', (v_coaf->>'limite_configurado')::boolean, 'encargos', v_has_encargos));
END $function$;

-- ------------------------------------------------------------
-- Cadastro em 3 lugares (regra de 07/09): menu (module_catalog) + auditoria (system_screens) + botoes.
--   Sem o primeiro, a tela nasce sem porta (foi o que aconteceu com Preparacao e Demanda).
-- ------------------------------------------------------------
INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, legacy, descricao, layer, vertical_specific)
VALUES
  ('revenda_painel', 'Revenda · Painel do dono', 'revenda_veiculos', 'revenda_veiculos',
   'LayoutDashboard', '/dashboard/revenda', 186, true, false,
   'Painel do dono: capital parado, giro, semaforo em dinheiro, pendencias clicaveis e alerta COAF de especie.',
   (SELECT layer FROM module_catalog WHERE id = 'revenda_patio'),
   (SELECT vertical_specific FROM module_catalog WHERE id = 'revenda_patio'))
ON CONFLICT (id) DO NOTHING;
SELECT public.fn_vincular_modulo_aos_planos('revenda_painel');

INSERT INTO public.system_screens (id, rota, area, titulo, estado_real)
VALUES ('S.revenda.painel', '/dashboard/revenda', 'revenda', 'Revenda · Painel do dono', 'desconhecida')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.gold_screen_buttons
  (id, screen_id, rota, botao_label, botao_selector_css, destino_esperado_rota, destino_esperado_descricao, prioridade, tipo, ativo, cadastrado_por)
SELECT gen_random_uuid(), x.screen_id, x.rota, x.label, x.selector, x.destino, x.descricao, x.prioridade, x.tipo, true, 'engenheiro_chefe'
FROM (VALUES
  ('S.revenda.painel', '/dashboard/revenda', 'marcar como comunicado', 'button:has-text("marcar como comunicado")',
    NULL::text, 'Marca a ocorrencia COAF como comunicada ao SISCOAF (com protocolo). O sistema NAO comunica sozinho.', 'critico', 'acao'),
  ('S.revenda.painel', '/dashboard/revenda', 'ver venda', 'a:has-text("ver venda")',
    '/dashboard/revenda/vendas', 'Abre a venda da ocorrencia COAF', 'normal', 'navegacao'),
  ('S.revenda.painel', '/dashboard/revenda', 'configurar', 'a:has-text("configurar")',
    '/dashboard/cadastros/plano-contas', 'Vai configurar o carrego (plano de contas na Gestao Empresarial)', 'normal', 'navegacao')
) AS x(screen_id, rota, label, selector, destino, descricao, prioridade, tipo)
WHERE NOT EXISTS (SELECT 1 FROM gold_screen_buttons g WHERE g.screen_id = x.screen_id AND g.botao_label = x.label);
