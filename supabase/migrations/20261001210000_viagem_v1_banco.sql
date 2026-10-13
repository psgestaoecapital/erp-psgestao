-- Viagem · V1 (banco) — fechamento administrativo da FC (plano aprovado pelo CEO 30/09; "1 dia de tela de viagem" 01/10).
-- Um registro de viagem só, para os dois modos (administrativo agora; celular em novembro) e para a importação da planilha
-- (src/lib/viagem/modeloPlanilha.ts). Decisão CEO: só viagens NOVAS — nada de importar viagens antigas (a 471 foi só
-- exemplo de layout). Esta fase cria o registro, os lançamentos (despesas e abastecimentos) e o resumo/prestação de
-- contas (adiantamento 5.01 × gastos × saldo a devolver ou a reembolsar 5.02), com as MESMAS contas da planilha.
-- Fecha e gera os títulos na GE (centro de custo = obra, sem duplicar) na fase V2, junto com a tela.
-- Tudo com company_id, RLS por empresa, nada aberto a quem não está logado; gravação só pelas funções com guarda de
-- empresa; exclusão lógica (RD-30).

-- ── 1) configuração por empresa ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_viagem_config (
  company_id        uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  modo              text NOT NULL DEFAULT 'administrativo' CHECK (modo IN ('administrativo', 'campo', 'ambos')),
  cat_adiantamento  text NOT NULL DEFAULT '5.01',
  cat_reembolso     text NOT NULL DEFAULT '5.02',
  cat_combustivel   text NOT NULL DEFAULT '2.06',
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_por    uuid
);

-- ── 2) a viagem (cabeçalho) ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_viagem (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  numero           integer NOT NULL,
  colaborador_nome text NOT NULL CHECK (length(btrim(colaborador_nome)) > 0),
  funcionario_id   uuid REFERENCES public.compliance_funcionarios(id) ON DELETE SET NULL,
  placa            text,
  obra_id          uuid NOT NULL REFERENCES public.projetos_obras(id),
  periodo_inicio   date NOT NULL,
  periodo_fim      date NOT NULL,
  origem           text,
  destino          text,
  km_inicial       numeric(12,1) CHECK (km_inicial >= 0),
  km_final         numeric(12,1) CHECK (km_final >= 0),
  adiantamento     numeric(14,2) NOT NULL DEFAULT 0 CHECK (adiantamento >= 0),
  status           text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'fechada', 'cancelada')),
  origem_registro  text NOT NULL DEFAULT 'administrativo' CHECK (origem_registro IN ('administrativo', 'campo', 'planilha')),
  observacao       text,
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  fechada_em       timestamptz,
  fechada_por      uuid,
  excluido_em      timestamptz,
  excluido_por     uuid,
  UNIQUE (company_id, numero),
  CHECK (periodo_fim >= periodo_inicio),
  CHECK (km_final IS NULL OR km_inicial IS NULL OR km_final >= km_inicial)
);
CREATE INDEX IF NOT EXISTS erp_viagem_lista_idx ON public.erp_viagem (company_id, periodo_inicio DESC) WHERE excluido_em IS NULL;

-- ── 3) lançamentos (despesas e abastecimentos), cada um com a SUA obra (rateio entre obras) ──────────────────
CREATE TABLE IF NOT EXISTS public.erp_viagem_lancamento (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  viagem_id        uuid NOT NULL REFERENCES public.erp_viagem(id) ON DELETE CASCADE,
  tipo             text NOT NULL CHECK (tipo IN ('despesa', 'abastecimento')),
  data             date NOT NULL,
  fornecedor_nome  text NOT NULL CHECK (length(btrim(fornecedor_nome)) > 0),
  documento        text,
  tipo_despesa     text,
  categoria        text NOT NULL,
  descricao        text,
  forma_pagamento  text NOT NULL CHECK (forma_pagamento IN ('dinheiro', 'cartao_empresa', 'cartao_proprio', 'pix', 'a_prazo')),
  pago_colaborador boolean NOT NULL DEFAULT false,
  valor            numeric(14,2) NOT NULL CHECK (valor > 0),
  obra_id          uuid NOT NULL REFERENCES public.projetos_obras(id),
  placa            text,
  hodometro        numeric(12,1),
  litros           numeric(10,3),
  tanque_cheio     boolean,
  anexo_path       text,
  pagar_id         uuid,
  origem_registro  text NOT NULL DEFAULT 'administrativo' CHECK (origem_registro IN ('administrativo', 'campo', 'planilha')),
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  excluido_em      timestamptz,
  excluido_por     uuid,
  CHECK (tipo <> 'abastecimento' OR (litros > 0 AND hodometro IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS erp_viagem_lancamento_viagem_idx ON public.erp_viagem_lancamento (viagem_id) WHERE excluido_em IS NULL;

-- ── 4) RLS: leitura pela empresa; gravação só pelas funções (que conferem empresa, status e regras) ──────────
ALTER TABLE public.erp_viagem_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_viagem ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_viagem_lancamento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_viagem_config, public.erp_viagem, public.erp_viagem_lancamento FROM PUBLIC, anon;

DROP POLICY IF EXISTS erp_viagem_config_ler ON public.erp_viagem_config;
CREATE POLICY erp_viagem_config_ler ON public.erp_viagem_config FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS erp_viagem_ler ON public.erp_viagem;
CREATE POLICY erp_viagem_ler ON public.erp_viagem FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS erp_viagem_lancamento_ler ON public.erp_viagem_lancamento;
CREATE POLICY erp_viagem_lancamento_ler ON public.erp_viagem_lancamento FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.erp_viagem_config, public.erp_viagem, public.erp_viagem_lancamento TO authenticated;

-- ── 5) configuração: ler (com padrão) e salvar (só gestor) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_viagem_config_salvar(p_company_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_modo text := COALESCE(NULLIF(btrim(p_dados->>'modo'), ''), 'administrativo');
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF auth.uid() IS NOT NULL AND NOT public.fn_acessos_pode_gerir(p_company_id) THEN
    RAISE EXCEPTION 'Só o gestor da empresa altera a configuração da viagem' USING ERRCODE = '42501';
  END IF;
  IF v_modo NOT IN ('administrativo', 'campo', 'ambos') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'modo inválido (administrativo, campo ou ambos)');
  END IF;
  INSERT INTO public.erp_viagem_config (company_id, modo, cat_adiantamento, cat_reembolso, cat_combustivel, atualizado_por)
  VALUES (p_company_id, v_modo,
          COALESCE(NULLIF(btrim(p_dados->>'cat_adiantamento'), ''), '5.01'),
          COALESCE(NULLIF(btrim(p_dados->>'cat_reembolso'), ''), '5.02'),
          COALESCE(NULLIF(btrim(p_dados->>'cat_combustivel'), ''), '2.06'),
          auth.uid())
  ON CONFLICT (company_id) DO UPDATE SET modo = EXCLUDED.modo, cat_adiantamento = EXCLUDED.cat_adiantamento,
     cat_reembolso = EXCLUDED.cat_reembolso, cat_combustivel = EXCLUDED.cat_combustivel,
     atualizado_em = now(), atualizado_por = auth.uid();
  RETURN jsonb_build_object('ok', true, 'modo', v_modo);
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_config_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_config_salvar(uuid, jsonb) TO authenticated, service_role;

-- ── 6) salvar a viagem (cria ou altera enquanto aberta) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_viagem_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_v        public.erp_viagem%ROWTYPE;
  v_obra     uuid := NULLIF(p_dados->>'obra_id', '')::uuid;
  v_ini      date := NULLIF(p_dados->>'periodo_inicio', '')::date;
  v_fim      date := NULLIF(p_dados->>'periodo_fim', '')::date;
  v_colab    text := NULLIF(btrim(p_dados->>'colaborador_nome'), '');
  v_func     uuid := NULLIF(p_dados->>'funcionario_id', '')::uuid;
  v_numero   integer := NULLIF(p_dados->>'numero', '')::integer;
  v_id       uuid;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF v_colab IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o colaborador'); END IF;
  IF v_ini IS NULL OR v_fim IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o período (saída e volta)'); END IF;
  IF v_fim < v_ini THEN RETURN jsonb_build_object('ok', false, 'erro', 'A volta não pode ser antes da saída'); END IF;
  IF v_obra IS NULL OR NOT EXISTS (SELECT 1 FROM public.projetos_obras o WHERE o.id = v_obra AND o.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Escolha uma obra desta empresa (cadastre a obra antes)');
  END IF;
  IF v_func IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.compliance_funcionarios f WHERE f.id = v_func AND f.company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Colaborador de outra empresa');
  END IF;

  IF p_id IS NULL THEN
    -- número: o informado (se a empresa numera) ou o próximo da empresa
    IF v_numero IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('erp_viagem_numero:' || p_company_id::text));
      SELECT COALESCE(max(numero), 0) + 1 INTO v_numero FROM public.erp_viagem WHERE company_id = p_company_id;
    ELSIF EXISTS (SELECT 1 FROM public.erp_viagem WHERE company_id = p_company_id AND numero = v_numero) THEN
      RETURN jsonb_build_object('ok', false, 'erro', format('Já existe a viagem nº %s', v_numero));
    END IF;
    INSERT INTO public.erp_viagem (company_id, numero, colaborador_nome, funcionario_id, placa, obra_id, periodo_inicio, periodo_fim,
                                   origem, destino, km_inicial, km_final, adiantamento, origem_registro, observacao, criado_por)
    VALUES (p_company_id, v_numero, v_colab, v_func, upper(NULLIF(btrim(p_dados->>'placa'), '')), v_obra, v_ini, v_fim,
            NULLIF(btrim(p_dados->>'origem'), ''), NULLIF(btrim(p_dados->>'destino'), ''),
            NULLIF(p_dados->>'km_inicial', '')::numeric, NULLIF(p_dados->>'km_final', '')::numeric,
            COALESCE(NULLIF(p_dados->>'adiantamento', '')::numeric, 0),
            COALESCE(NULLIF(p_dados->>'origem_registro', ''), 'administrativo'),
            NULLIF(btrim(p_dados->>'observacao'), ''), auth.uid())
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
  END IF;

  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_v.company_id <> p_company_id OR v_v.excluido_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não encontrada');
  END IF;
  IF v_v.status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem fechada não se altera'); END IF;
  -- lançamentos já feitos precisam continuar dentro do novo período
  IF EXISTS (SELECT 1 FROM public.erp_viagem_lancamento l WHERE l.viagem_id = p_id AND l.excluido_em IS NULL AND (l.data < v_ini OR l.data > v_fim)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Há lançamentos fora do novo período');
  END IF;
  UPDATE public.erp_viagem SET colaborador_nome = v_colab, funcionario_id = v_func, placa = upper(NULLIF(btrim(p_dados->>'placa'), '')),
         obra_id = v_obra, periodo_inicio = v_ini, periodo_fim = v_fim,
         origem = NULLIF(btrim(p_dados->>'origem'), ''), destino = NULLIF(btrim(p_dados->>'destino'), ''),
         km_inicial = NULLIF(p_dados->>'km_inicial', '')::numeric, km_final = NULLIF(p_dados->>'km_final', '')::numeric,
         adiantamento = COALESCE(NULLIF(p_dados->>'adiantamento', '')::numeric, 0),
         observacao = NULLIF(btrim(p_dados->>'observacao'), ''), atualizado_em = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'numero', v_v.numero);
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

-- ── 7) lançamento: mesmas regras da planilha (data no período, categoria da empresa, forma da lista, valor > 0,
--       hodômetro dentro do km da viagem, obra da empresa). Grava só em viagem aberta. ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_viagem_lancamento_salvar(p_viagem_id uuid, p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_v      public.erp_viagem%ROWTYPE;
  v_cfg    public.erp_viagem_config%ROWTYPE;
  v_tipo   text := COALESCE(NULLIF(p_dados->>'tipo', ''), 'despesa');
  v_data   date := NULLIF(p_dados->>'data', '')::date;
  v_forn   text := NULLIF(btrim(p_dados->>'fornecedor_nome'), '');
  v_cat    text := NULLIF(btrim(p_dados->>'categoria'), '');
  v_forma  text := NULLIF(btrim(p_dados->>'forma_pagamento'), '');
  v_valor  numeric := NULLIF(p_dados->>'valor', '')::numeric;
  v_obra   uuid := NULLIF(p_dados->>'obra_id', '')::uuid;
  v_hod    numeric := NULLIF(p_dados->>'hodometro', '')::numeric;
  v_litros numeric := NULLIF(p_dados->>'litros', '')::numeric;
  v_erros  text[] := ARRAY[]::text[];
  v_id     uuid;
BEGIN
  SELECT * INTO v_v FROM public.erp_viagem WHERE id = p_viagem_id;
  IF NOT FOUND OR v_v.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_v.company_id);
  IF v_v.status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem fechada não recebe lançamento'); END IF;
  SELECT * INTO v_cfg FROM public.erp_viagem_config WHERE company_id = v_v.company_id;

  IF v_tipo NOT IN ('despesa', 'abastecimento') THEN v_erros := array_append(v_erros, 'tipo: despesa ou abastecimento'::text); END IF;
  IF v_data IS NULL OR v_data < v_v.periodo_inicio OR v_data > v_v.periodo_fim THEN v_erros := array_append(v_erros, 'data: fora do período da viagem'::text); END IF;
  IF v_forn IS NULL THEN v_erros := array_append(v_erros, 'fornecedor: obrigatório'::text); END IF;
  IF v_tipo = 'abastecimento' AND v_cat IS NULL THEN v_cat := COALESCE(v_cfg.cat_combustivel, '2.06'); END IF;
  IF v_cat IS NULL OR NOT EXISTS (SELECT 1 FROM public.erp_plano_contas c WHERE c.company_id = v_v.company_id AND c.codigo = v_cat AND COALESCE(c.ativo, true)) THEN
    v_erros := array_append(v_erros, 'categoria: não é uma categoria da empresa'::text);
  END IF;
  IF v_forma IS NULL OR v_forma NOT IN ('dinheiro', 'cartao_empresa', 'cartao_proprio', 'pix', 'a_prazo') THEN v_erros := array_append(v_erros, 'forma de pagamento: fora da lista'::text); END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN v_erros := array_append(v_erros, 'valor: maior que zero'::text); END IF;
  v_obra := COALESCE(v_obra, v_v.obra_id);
  IF NOT EXISTS (SELECT 1 FROM public.projetos_obras o WHERE o.id = v_obra AND o.company_id = v_v.company_id) THEN v_erros := array_append(v_erros, 'obra: não é desta empresa'::text); END IF;
  IF v_tipo = 'abastecimento' THEN
    IF v_litros IS NULL OR v_litros <= 0 THEN v_erros := array_append(v_erros, 'litros: maior que zero'::text); END IF;
    IF v_hod IS NULL THEN v_erros := array_append(v_erros, 'hodômetro: obrigatório'::text);
    ELSIF (v_v.km_inicial IS NOT NULL AND v_hod < v_v.km_inicial) OR (v_v.km_final IS NOT NULL AND v_hod > v_v.km_final) THEN
      v_erros := array_append(v_erros, 'hodômetro: fora do km inicial/final da viagem'::text);
    END IF;
  END IF;
  IF array_length(v_erros, 1) > 0 THEN RETURN jsonb_build_object('ok', false, 'erros', to_jsonb(v_erros)); END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.erp_viagem_lancamento (company_id, viagem_id, tipo, data, fornecedor_nome, documento, tipo_despesa, categoria, descricao,
       forma_pagamento, pago_colaborador, valor, obra_id, placa, hodometro, litros, tanque_cheio, anexo_path, origem_registro, criado_por)
    VALUES (v_v.company_id, v_v.id, v_tipo, v_data, v_forn, NULLIF(btrim(p_dados->>'documento'), ''), NULLIF(btrim(p_dados->>'tipo_despesa'), ''),
       v_cat, NULLIF(btrim(p_dados->>'descricao'), ''), v_forma, COALESCE((p_dados->>'pago_colaborador')::boolean, false), round(v_valor, 2),
       v_obra, upper(NULLIF(btrim(COALESCE(p_dados->>'placa', v_v.placa)), '')), v_hod, v_litros, (p_dados->>'tanque_cheio')::boolean,
       NULLIF(btrim(p_dados->>'anexo_path'), ''), COALESCE(NULLIF(p_dados->>'origem_registro', ''), v_v.origem_registro), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_viagem_lancamento SET tipo = v_tipo, data = v_data, fornecedor_nome = v_forn, documento = NULLIF(btrim(p_dados->>'documento'), ''),
           tipo_despesa = NULLIF(btrim(p_dados->>'tipo_despesa'), ''), categoria = v_cat, descricao = NULLIF(btrim(p_dados->>'descricao'), ''),
           forma_pagamento = v_forma, pago_colaborador = COALESCE((p_dados->>'pago_colaborador')::boolean, false), valor = round(v_valor, 2),
           obra_id = v_obra, placa = upper(NULLIF(btrim(COALESCE(p_dados->>'placa', v_v.placa)), '')), hodometro = v_hod, litros = v_litros,
           tanque_cheio = (p_dados->>'tanque_cheio')::boolean, anexo_path = COALESCE(NULLIF(btrim(p_dados->>'anexo_path'), ''), anexo_path)
     WHERE id = p_id AND viagem_id = v_v.id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento não encontrado nesta viagem'); END IF;
  END IF;
  UPDATE public.erp_viagem SET atualizado_em = now() WHERE id = v_v.id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_lancamento_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_lancamento_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

-- exclusão lógica do lançamento (viagem aberta)
CREATE OR REPLACE FUNCTION public.fn_viagem_lancamento_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_l public.erp_viagem_lancamento%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO v_l FROM public.erp_viagem_lancamento WHERE id = p_id;
  IF NOT FOUND OR v_l.excluido_em IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_l.company_id);
  SELECT status INTO v_status FROM public.erp_viagem WHERE id = v_l.viagem_id;
  IF v_status <> 'aberta' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Viagem fechada não se altera'); END IF;
  UPDATE public.erp_viagem_lancamento SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;
REVOKE ALL ON FUNCTION public.fn_viagem_lancamento_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_lancamento_excluir(uuid) TO authenticated, service_role;

-- ── 8) resumo / prestação de contas — as MESMAS contas da planilha (lerPlanilhaViagem), com a RLS de quem chama:
--   total = despesas + abastecimentos; a prazo = forma 'a_prazo'; à vista = total − a prazo;
--   pago pelo colaborador = Σ dos marcados; saldo = adiantamento − pago pelo colaborador
--   (> 0 colaborador devolve à empresa · < 0 empresa reembolsa o colaborador);
--   km = final − inicial; média = km ÷ litros; custo/km = total ÷ km; por categoria e por obra. ──────────────────
CREATE OR REPLACE FUNCTION public.fn_viagem_resumo(p_viagem_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH v AS (SELECT * FROM public.erp_viagem WHERE id = p_viagem_id AND excluido_em IS NULL),
  l AS (SELECT x.* FROM public.erp_viagem_lancamento x JOIN v ON v.id = x.viagem_id WHERE x.excluido_em IS NULL),
  t AS (
    SELECT round(COALESCE(sum(valor) FILTER (WHERE tipo = 'despesa'), 0), 2)       AS total_despesas,
           round(COALESCE(sum(valor) FILTER (WHERE tipo = 'abastecimento'), 0), 2) AS total_abastecimentos,
           round(COALESCE(sum(valor), 0), 2)                                        AS total,
           round(COALESCE(sum(valor) FILTER (WHERE forma_pagamento = 'a_prazo'), 0), 2) AS a_prazo,
           round(COALESCE(sum(valor) FILTER (WHERE pago_colaborador), 0), 2)       AS pago_colaborador,
           round(COALESCE(sum(litros) FILTER (WHERE tipo = 'abastecimento'), 0), 3) AS litros
      FROM l),
  k AS (SELECT CASE WHEN v.km_inicial IS NOT NULL AND v.km_final IS NOT NULL AND v.km_final >= v.km_inicial
                    THEN v.km_final - v.km_inicial END AS km FROM v)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL ELSE jsonb_build_object(
    'total_despesas', t.total_despesas, 'total_abastecimentos', t.total_abastecimentos, 'total', t.total,
    'a_prazo', t.a_prazo, 'a_vista', round(t.total - t.a_prazo, 2), 'pago_colaborador', t.pago_colaborador,
    'adiantamento', (SELECT adiantamento FROM v),
    'saldo', round((SELECT adiantamento FROM v) - t.pago_colaborador, 2),
    'saldo_texto', CASE WHEN (SELECT adiantamento FROM v) - t.pago_colaborador > 0 THEN 'colaborador devolve à empresa'
                        WHEN (SELECT adiantamento FROM v) - t.pago_colaborador < 0 THEN 'empresa reembolsa o colaborador'
                        ELSE 'acertado' END,
    'km_rodado', k.km, 'litros', t.litros,
    'media_km_l', CASE WHEN k.km IS NOT NULL AND t.litros > 0 THEN round(k.km / t.litros, 2) END,
    'custo_km', CASE WHEN k.km > 0 THEN round(t.total / k.km, 2) END,
    'por_categoria', COALESCE((SELECT jsonb_object_agg(categoria, s) FROM (SELECT categoria, round(sum(valor), 2) s FROM l GROUP BY categoria) c), '{}'::jsonb),
    'por_obra', COALESCE((SELECT jsonb_object_agg(obra_id, s) FROM (SELECT obra_id, round(sum(valor), 2) s FROM l GROUP BY obra_id) o), '{}'::jsonb),
    'lancamentos', (SELECT count(*) FROM l)) END
  FROM t, k
$function$;
REVOKE ALL ON FUNCTION public.fn_viagem_resumo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_resumo(uuid) TO authenticated, service_role;
