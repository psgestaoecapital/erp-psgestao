-- Viagem ligada à CARGA (Indústria) — Parte 1: fundação de dados (CEO 29/10 10:48).
-- Contexto: /dashboard/industrial/logistica/viagens reusa a tela de Viagens do Hub, mas erp_viagem.obra_id e
-- erp_viagem_lancamento.obra_id eram NOT NULL. Empresa de indústria (Frioeste) não tem obras: a tela abria e não
-- salvava nada. Decisão do CEO: na Indústria a viagem se liga à CARGA (romaneio de saída do ERP de origem — ATAK hoje,
-- a mesma carga que fn_com_venda_item devolve). O Hub continua exigindo obra.
--
-- Esta migration é ADITIVA e preserva 100% o comportamento do Hub:
--   • erp_viagem / erp_viagem_lancamento ganham a coluna `carga` (text, nullable) e obra_id passa a aceitar NULL,
--     com CHECK (obra_id IS NOT NULL OR carga IS NOT NULL) — ou seja, toda viagem continua obrigada a ter vínculo.
--   • fn_viagem_salvar / fn_viagem_lancamento_salvar: Hub = obra obrigatória (como hoje); Indústria = carga obrigatória.
--   • fn_viagem_cargas_disponiveis: RPC de leitura que lista as cargas do período (via o tradutor genérico
--     fn_com_venda_item, nunca ATAK direto), para o seletor de carga da tela.
--
-- PARTE 2 (sessão acompanhada): extração do componente para _compartilhado com prop de vínculo (obra|carga, RD-35),
-- fechamento no GE para viagem de carga (centro de custo = logística da empresa; erp_viagem_ge_titulo.obra_id relaxado),
-- indicadores custo/kg e custo por cliente, "?" (RD-95) na tela da Indústria e spec e2e do caminho principal.
-- Nenhum dado do Hub muda; nenhuma viagem existente é alterada (0 linhas com obra_id nulo no momento desta migration).

BEGIN;

-- 1) Coluna de vínculo por carga + obra_id opcional, com CHECK que mantém o invariante "toda viagem tem vínculo".
ALTER TABLE public.erp_viagem            ADD COLUMN IF NOT EXISTS carga text;
ALTER TABLE public.erp_viagem_lancamento ADD COLUMN IF NOT EXISTS carga text;

ALTER TABLE public.erp_viagem            ALTER COLUMN obra_id DROP NOT NULL;
ALTER TABLE public.erp_viagem_lancamento ALTER COLUMN obra_id DROP NOT NULL;

ALTER TABLE public.erp_viagem            DROP CONSTRAINT IF EXISTS erp_viagem_vinculo_chk;
ALTER TABLE public.erp_viagem            ADD  CONSTRAINT erp_viagem_vinculo_chk
  CHECK (obra_id IS NOT NULL OR NULLIF(btrim(carga), '') IS NOT NULL);
ALTER TABLE public.erp_viagem_lancamento DROP CONSTRAINT IF EXISTS erp_viagem_lancamento_vinculo_chk;
ALTER TABLE public.erp_viagem_lancamento ADD  CONSTRAINT erp_viagem_lancamento_vinculo_chk
  CHECK (obra_id IS NOT NULL OR NULLIF(btrim(carga), '') IS NOT NULL);

COMMENT ON COLUMN public.erp_viagem.carga IS
  'Vínculo por carga (romaneio de saída) para viagem de Indústria, quando não há obra. Hub usa obra_id; Indústria usa carga.';
COMMENT ON COLUMN public.erp_viagem_lancamento.carga IS
  'Carga herdada da viagem quando a viagem não tem obra (Indústria).';

-- 2) fn_viagem_salvar — carga-aware. Hub (sem carga no payload) permanece idêntico: obra obrigatória.
CREATE OR REPLACE FUNCTION public.fn_viagem_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_v        public.erp_viagem%ROWTYPE;
  v_obra     uuid := NULLIF(p_dados->>'obra_id', '')::uuid;
  v_carga    text := NULLIF(btrim(p_dados->>'carga'), '');
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
  -- Vínculo: carga (Indústria) OU obra (Hub). Carga tem precedência; sem carga, a obra é obrigatória como hoje.
  IF v_carga IS NULL THEN
    IF v_obra IS NULL OR NOT EXISTS (SELECT 1 FROM public.projetos_obras o WHERE o.id = v_obra AND o.company_id = p_company_id) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Escolha uma obra desta empresa (cadastre a obra antes) ou informe a carga');
    END IF;
  ELSE
    v_obra := NULL;   -- viagem de carga (Indústria) não se liga a obra
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
    INSERT INTO public.erp_viagem (company_id, numero, colaborador_nome, funcionario_id, placa, obra_id, carga, periodo_inicio, periodo_fim,
                                   origem, destino, km_inicial, km_final, adiantamento, origem_registro, observacao, criado_por)
    VALUES (p_company_id, v_numero, v_colab, v_func, upper(NULLIF(btrim(p_dados->>'placa'), '')), v_obra, v_carga, v_ini, v_fim,
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
         obra_id = v_obra, carga = v_carga, periodo_inicio = v_ini, periodo_fim = v_fim,
         origem = NULLIF(btrim(p_dados->>'origem'), ''), destino = NULLIF(btrim(p_dados->>'destino'), ''),
         km_inicial = NULLIF(p_dados->>'km_inicial', '')::numeric, km_final = NULLIF(p_dados->>'km_final', '')::numeric,
         adiantamento = COALESCE(NULLIF(p_dados->>'adiantamento', '')::numeric, 0),
         observacao = NULLIF(btrim(p_dados->>'observacao'), ''), atualizado_em = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'numero', v_v.numero);
END $function$;

REVOKE ALL ON FUNCTION public.fn_viagem_salvar(uuid, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

-- 3) fn_viagem_lancamento_salvar — herda o vínculo da viagem. Viagem de carga ⇒ lançamento sem obra, com a carga da viagem.
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
  v_carga  text;
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
  -- Vínculo herdado da viagem: obra (Hub) ou carga (Indústria). Viagem de carga ⇒ lançamento sem obra.
  IF v_v.obra_id IS NULL THEN
    v_obra  := NULL;
    v_carga := v_v.carga;   -- herda a carga da viagem
  ELSE
    v_obra  := COALESCE(v_obra, v_v.obra_id);
    v_carga := NULL;
    IF NOT EXISTS (SELECT 1 FROM public.projetos_obras o WHERE o.id = v_obra AND o.company_id = v_v.company_id) THEN v_erros := array_append(v_erros, 'obra: não é desta empresa'::text); END IF;
  END IF;
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
       forma_pagamento, pago_colaborador, valor, obra_id, carga, placa, hodometro, litros, tanque_cheio, anexo_path, origem_registro, criado_por)
    VALUES (v_v.company_id, v_v.id, v_tipo, v_data, v_forn, NULLIF(btrim(p_dados->>'documento'), ''), NULLIF(btrim(p_dados->>'tipo_despesa'), ''),
       v_cat, NULLIF(btrim(p_dados->>'descricao'), ''), v_forma, COALESCE((p_dados->>'pago_colaborador')::boolean, false), round(v_valor, 2),
       v_obra, v_carga, upper(NULLIF(btrim(COALESCE(p_dados->>'placa', v_v.placa)), '')), v_hod, v_litros, (p_dados->>'tanque_cheio')::boolean,
       NULLIF(btrim(p_dados->>'anexo_path'), ''), COALESCE(NULLIF(p_dados->>'origem_registro', ''), v_v.origem_registro), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_viagem_lancamento SET tipo = v_tipo, data = v_data, fornecedor_nome = v_forn, documento = NULLIF(btrim(p_dados->>'documento'), ''),
           tipo_despesa = NULLIF(btrim(p_dados->>'tipo_despesa'), ''), categoria = v_cat, descricao = NULLIF(btrim(p_dados->>'descricao'), ''),
           forma_pagamento = v_forma, pago_colaborador = COALESCE((p_dados->>'pago_colaborador')::boolean, false), valor = round(v_valor, 2),
           obra_id = v_obra, carga = v_carga, placa = upper(NULLIF(btrim(COALESCE(p_dados->>'placa', v_v.placa)), '')), hodometro = v_hod, litros = v_litros,
           tanque_cheio = (p_dados->>'tanque_cheio')::boolean, anexo_path = COALESCE(NULLIF(btrim(p_dados->>'anexo_path'), ''), anexo_path)
     WHERE id = p_id AND viagem_id = v_v.id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Lançamento não encontrado nesta viagem'); END IF;
  END IF;
  UPDATE public.erp_viagem SET atualizado_em = now() WHERE id = v_v.id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_viagem_lancamento_salvar(uuid, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_lancamento_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

-- 4) fn_viagem_cargas_disponiveis — leitura: lista as cargas do período para o seletor da Indústria.
--    Usa o tradutor genérico fn_com_venda_item (nunca ATAK direto na tela). Guarda de empresa obrigatória.
CREATE OR REPLACE FUNCTION public.fn_viagem_cargas_disponiveis(p_company_id uuid, p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe um período válido (de/até)');
  END IF;
  IF p_ate - p_de > 400 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Período muito longo: use no máximo ~13 meses');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'carga', carga, 'dia', dia, 'transportador', transportador,
           'clientes', clientes, 'cidades', cidades, 'kg', kg, 'valor', valor, 'itens', itens)
           ORDER BY dia DESC, carga), '[]'::jsonb)
    INTO v_res
  FROM (
    SELECT i.carga,
           max(i.dia)                                      AS dia,
           (array_agg(i.transportador ORDER BY i.dia DESC))[1] AS transportador,
           count(DISTINCT i.cliente_cod)::int              AS clientes,
           count(DISTINCT i.cidade)::int                   AS cidades,
           round(sum(i.kg), 2)                             AS kg,
           round(sum(i.valor), 2)                          AS valor,
           count(*)::int                                   AS itens
      FROM public.fn_com_venda_item(p_company_id, p_de, p_ate) i
     WHERE NULLIF(btrim(i.carga), '') IS NOT NULL
     GROUP BY i.carga
  ) s;
  RETURN jsonb_build_object('ok', true, 'cargas', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_viagem_cargas_disponiveis(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_cargas_disponiveis(uuid, date, date) TO authenticated, service_role;

-- 5) RD-95: "?" da tela da Indústria (usado na Parte 2). Chave nova = linha nova aqui (idempotente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Viagem (Indústria)', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/industrial/logistica/viagens', 'industria', 'publicado'
FROM (VALUES
 ('industria.viagem.carga',
  'Carga (romaneio de saída)',
  'Escolha a carga do romaneio de saída do período. A lista traz número da carga, dia, transportador, cidades e kg.',
  'Liga a viagem à carga entregue (e não a uma obra, como no Hub de Projetos), para apurar o custo do transporte por carga.',
  'Carga 10482 · 30/10 · Transportes XYZ · 3 cidades · 12.400 kg.',
  'Procurar uma obra: na Indústria a viagem se liga à carga, não à obra.',
  1),
 ('industria.viagem.carga_periodo',
  'Período das cargas',
  'Ajuste as datas para carregar as cargas daquele intervalo no seletor.',
  'Filtra quais cargas aparecem para vincular à viagem (por padrão, os últimos dias).',
  '01/10 a 31/10.',
  'Período muito largo deixa a lista longa; use o intervalo da viagem.',
  2)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);

COMMIT;
