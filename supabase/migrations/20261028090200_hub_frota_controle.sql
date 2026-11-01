-- Hub · Controle de frota (chamado #5166, FC/FCR, Jordana) — veículos, plano preventivo, manutenções e consumo.
-- O km e o abastecimento NÃO são digitados: vêm das VIAGENS já lançadas (erp_viagem.km_inicial/km_final e
-- erp_viagem_lancamento.hodometro/litros). A tabela erp_frota NÃO é usada (é de outro contexto: carteira de cliente).
-- RD-98: tela viva + CRUD (veículo, plano, manutenção) + origem do dado (views_consumidas/rpcs_chamadas) + exclusão
-- rastreável (soft-delete com quem/quando e audit_log_global). RD-95: ajuda ("?") nos campos.
-- Migration ADITIVA: 3 tabelas novas, RPCs novas, metadados da tela. Nada existente é alterado.
-- km_atual NÃO é gravado: é calculado a cada leitura (maior km conhecido), para nunca ficar desatualizado.

-- 1) VEÍCULO -------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_hub_frota_veiculo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  placa        text NOT NULL CHECK (length(placa) >= 6),
  modelo       text,
  marca        text,
  ano          integer CHECK (ano IS NULL OR ano BETWEEN 1950 AND 2100),
  tipo         text NOT NULL DEFAULT 'carro' CHECK (tipo IN ('carro', 'caminhonete', 'caminhao', 'moto')),
  chassi       text,
  renavam      text,
  km_inicial   numeric NOT NULL DEFAULT 0 CHECK (km_inicial >= 0),
  observacao   text,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_por   uuid DEFAULT auth.uid(),
  excluido_em  timestamptz,
  excluido_por uuid
);
-- a mesma placa não pode estar duas vezes ATIVA na empresa (excluído pode ser recadastrado)
CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_frota_veiculo_placa
  ON public.erp_hub_frota_veiculo (company_id, placa) WHERE excluido_em IS NULL;

-- 2) PLANO PREVENTIVO (a cada quantos km, por tipo de manutenção) --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_hub_frota_manutencao_plano (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id   uuid NOT NULL REFERENCES public.erp_hub_frota_veiculo(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (length(btrim(tipo)) > 0),
  intervalo_km numeric NOT NULL CHECK (intervalo_km > 0),
  ultimo_km    numeric NOT NULL DEFAULT 0 CHECK (ultimo_km >= 0),
  observacao   text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_por   uuid DEFAULT auth.uid(),
  excluido_em  timestamptz,
  excluido_por uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_frota_plano_tipo
  ON public.erp_hub_frota_manutencao_plano (veiculo_id, lower(tipo)) WHERE excluido_em IS NULL;

-- 3) HISTÓRICO DE MANUTENÇÕES FEITAS -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_hub_frota_manutencao_registro (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id        uuid NOT NULL REFERENCES public.erp_hub_frota_veiculo(id) ON DELETE CASCADE,
  tipo              text NOT NULL CHECK (length(btrim(tipo)) > 0),
  data              date NOT NULL DEFAULT current_date,
  km_na_manutencao  numeric NOT NULL CHECK (km_na_manutencao >= 0),
  valor             numeric CHECK (valor IS NULL OR valor >= 0),
  fornecedor        text,
  descricao         text,
  anexo_path        text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  criado_por        uuid DEFAULT auth.uid(),
  excluido_em       timestamptz,
  excluido_por      uuid
);
CREATE INDEX IF NOT EXISTS ix_hub_frota_registro_veiculo
  ON public.erp_hub_frota_manutencao_registro (veiculo_id, tipo) WHERE excluido_em IS NULL;

-- RLS: leitura por empresa; escrita SÓ pelas RPCs abaixo (SECURITY DEFINER com guarda de empresa).
ALTER TABLE public.erp_hub_frota_veiculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_hub_frota_manutencao_plano ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_hub_frota_manutencao_registro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hub_frota_veiculo_sel ON public.erp_hub_frota_veiculo;
CREATE POLICY hub_frota_veiculo_sel ON public.erp_hub_frota_veiculo FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS hub_frota_plano_sel ON public.erp_hub_frota_manutencao_plano;
CREATE POLICY hub_frota_plano_sel ON public.erp_hub_frota_manutencao_plano FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS hub_frota_registro_sel ON public.erp_hub_frota_manutencao_registro;
CREATE POLICY hub_frota_registro_sel ON public.erp_hub_frota_manutencao_registro FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.erp_hub_frota_veiculo, public.erp_hub_frota_manutencao_plano, public.erp_hub_frota_manutencao_registro FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_hub_frota_veiculo, public.erp_hub_frota_manutencao_plano, public.erp_hub_frota_manutencao_registro FROM authenticated;
GRANT SELECT ON public.erp_hub_frota_veiculo, public.erp_hub_frota_manutencao_plano, public.erp_hub_frota_manutencao_registro TO authenticated;
GRANT ALL ON public.erp_hub_frota_veiculo, public.erp_hub_frota_manutencao_plano, public.erp_hub_frota_manutencao_registro TO service_role;

-- 4) INDICADORES — o coração da tela ---------------------------------------------------------------------------------
-- km_atual  = maior km conhecido do veículo: km_inicial do cadastro, km_inicial/km_final das VIAGENS da placa,
--             hodômetro dos ABASTECIMENTOS da placa e km das manutenções registradas.
-- consumo   = km percorrido (soma de km_final-km_inicial das viagens) ÷ litros abastecidos (km/litro). Sem litros = nulo.
-- plano     = km_para_proxima = (ultimo_km + intervalo_km) - km_atual.
--             VERDE se > 20% do intervalo; AMARELO entre 0 e 20%; VERMELHO se <= 0 (venceu). Só aqui calcula o semáforo.
CREATE OR REPLACE FUNCTION public.fn_hub_frota_indicadores(p_company_id uuid, p_veiculo_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN (
    WITH v AS (
      SELECT * FROM public.erp_hub_frota_veiculo
       WHERE company_id = p_company_id AND excluido_em IS NULL AND (p_veiculo_id IS NULL OR id = p_veiculo_id)
    ),
    viag AS (
      SELECT upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) AS placa_n, km_inicial, km_final
        FROM public.erp_viagem
       WHERE company_id = p_company_id AND excluido_em IS NULL AND placa IS NOT NULL
    ),
    km_viag AS (
      SELECT placa_n,
             max(GREATEST(km_inicial, km_final)) AS km_max,
             sum(CASE WHEN km_inicial IS NOT NULL AND km_final IS NOT NULL AND km_final >= km_inicial
                      THEN km_final - km_inicial END) AS km_perc
        FROM viag GROUP BY placa_n
    ),
    abast AS (
      SELECT upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) AS placa_n, hodometro, litros
        FROM public.erp_viagem_lancamento
       WHERE company_id = p_company_id AND excluido_em IS NULL AND placa IS NOT NULL
         AND (tipo = 'abastecimento' OR tipo_despesa = 'combustivel')
    ),
    km_abast AS (
      SELECT placa_n, max(hodometro) AS km_max, sum(litros) AS litros FROM abast GROUP BY placa_n
    ),
    km_reg AS (
      SELECT veiculo_id, max(km_na_manutencao) AS km_max
        FROM public.erp_hub_frota_manutencao_registro
       WHERE company_id = p_company_id AND excluido_em IS NULL GROUP BY veiculo_id
    ),
    base AS (
      SELECT v.id, v.placa, v.modelo, v.marca, v.ano, v.tipo,
             GREATEST(v.km_inicial, kv.km_max, ka.km_max, kr.km_max) AS km_atual,
             coalesce(kv.km_perc, 0) AS km_percorrido,
             coalesce(ka.litros, 0) AS litros,
             CASE WHEN coalesce(ka.litros, 0) > 0 THEN round(coalesce(kv.km_perc, 0) / ka.litros, 2) END AS consumo_km_l
        FROM v
        LEFT JOIN km_viag kv ON kv.placa_n = v.placa
        LEFT JOIN km_abast ka ON ka.placa_n = v.placa
        LEFT JOIN km_reg kr ON kr.veiculo_id = v.id
    ),
    pl AS (
      SELECT p.veiculo_id,
             jsonb_agg(jsonb_build_object(
               'id', p.id, 'tipo', p.tipo, 'intervalo_km', p.intervalo_km, 'ultimo_km', p.ultimo_km,
               'proxima_km', p.ultimo_km + p.intervalo_km,
               'km_para_proxima', (p.ultimo_km + p.intervalo_km) - b.km_atual,
               'status', CASE WHEN (p.ultimo_km + p.intervalo_km) - b.km_atual <= 0 THEN 'vermelho'
                              WHEN (p.ultimo_km + p.intervalo_km) - b.km_atual > 0.2 * p.intervalo_km THEN 'verde'
                              ELSE 'amarelo' END
             ) ORDER BY (p.ultimo_km + p.intervalo_km) - b.km_atual) AS planos,
             count(*) FILTER (WHERE (p.ultimo_km + p.intervalo_km) - b.km_atual <= 0) AS vencidos,
             count(*) FILTER (WHERE (p.ultimo_km + p.intervalo_km) - b.km_atual > 0
                              AND (p.ultimo_km + p.intervalo_km) - b.km_atual <= 0.2 * p.intervalo_km) AS amarelos
        FROM public.erp_hub_frota_manutencao_plano p
        JOIN base b ON b.id = p.veiculo_id
       WHERE p.company_id = p_company_id AND p.excluido_em IS NULL
       GROUP BY p.veiculo_id
    ),
    veic AS (
      SELECT b.*, pl.planos, coalesce(pl.vencidos, 0) AS vencidos, coalesce(pl.amarelos, 0) AS amarelos,
             CASE WHEN coalesce(pl.vencidos, 0) > 0 THEN 'vermelho'
                  WHEN coalesce(pl.amarelos, 0) > 0 THEN 'amarelo'
                  WHEN pl.planos IS NOT NULL THEN 'verde'
                  ELSE 'sem_plano' END AS status_geral
        FROM base b LEFT JOIN pl ON pl.veiculo_id = b.id
    )
    SELECT jsonb_build_object(
      'resumo', jsonb_build_object(
        'total_veiculos', (SELECT count(*) FROM veic),
        'veiculos_vencidos', (SELECT count(*) FROM veic WHERE vencidos > 0),
        'consumo_medio_frota', (SELECT round(sum(km_percorrido) / nullif(sum(litros), 0), 2) FROM veic WHERE litros > 0)
      ),
      'veiculos', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'placa', x.placa, 'modelo', x.modelo, 'marca', x.marca, 'ano', x.ano, 'tipo', x.tipo,
          'km_atual', x.km_atual, 'km_percorrido', x.km_percorrido, 'litros', x.litros, 'consumo_km_l', x.consumo_km_l,
          'status_geral', x.status_geral, 'vencidos', x.vencidos, 'amarelos', x.amarelos,
          'planos', coalesce(x.planos, '[]'::jsonb)
        ) ORDER BY x.vencidos DESC, x.amarelos DESC, x.placa)
        FROM veic x
      ), '[]'::jsonb)
    )
  );
END
$function$;

-- 5) RPCs DE ESCRITA (guarda de empresa; sem INSERT/UPDATE direto) ----------------------------------------------------

-- 5a) veículo: criar/editar
CREATE OR REPLACE FUNCTION public.fn_hub_frota_veiculo_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_placa text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_placa := upper(regexp_replace(coalesce(p_dados->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_placa) < 6 THEN RAISE EXCEPTION 'Informe a placa do veículo (ex.: ABC1D23 ou ABC1234).'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.erp_hub_frota_veiculo (company_id, placa, modelo, marca, ano, tipo, chassi, renavam, km_inicial, observacao)
    VALUES (p_company_id, v_placa,
            nullif(btrim(p_dados->>'modelo'), ''), nullif(btrim(p_dados->>'marca'), ''),
            nullif(p_dados->>'ano', '')::integer, coalesce(nullif(p_dados->>'tipo', ''), 'carro'),
            nullif(btrim(p_dados->>'chassi'), ''), nullif(btrim(p_dados->>'renavam'), ''),
            coalesce(nullif(p_dados->>'km_inicial', '')::numeric, 0), nullif(btrim(p_dados->>'observacao'), ''))
    RETURNING id INTO v_id;
    INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (p_company_id, auth.uid(), 'erp_hub_frota_veiculo', v_id::text, 'criar', jsonb_build_object('placa', v_placa));
  ELSE
    UPDATE public.erp_hub_frota_veiculo SET
      placa = v_placa, modelo = nullif(btrim(p_dados->>'modelo'), ''), marca = nullif(btrim(p_dados->>'marca'), ''),
      ano = nullif(p_dados->>'ano', '')::integer, tipo = coalesce(nullif(p_dados->>'tipo', ''), tipo),
      chassi = nullif(btrim(p_dados->>'chassi'), ''), renavam = nullif(btrim(p_dados->>'renavam'), ''),
      km_inicial = coalesce(nullif(p_dados->>'km_inicial', '')::numeric, km_inicial),
      observacao = nullif(btrim(p_dados->>'observacao'), ''), atualizado_em = now()
     WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Veículo não encontrado (ou já excluído).'; END IF;
    INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (p_company_id, auth.uid(), 'erp_hub_frota_veiculo', v_id::text, 'editar', jsonb_build_object('placa', v_placa));
  END IF;
  RETURN v_id;
END
$function$;

-- 5b) veículo: excluir (soft, rastreável) e restaurar
CREATE OR REPLACE FUNCTION public.fn_hub_frota_veiculo_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.erp_hub_frota_veiculo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  IF a.excluido_em IS NOT NULL THEN RAISE EXCEPTION 'Este veículo já está excluído.'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  UPDATE public.erp_hub_frota_veiculo SET excluido_em = now(), excluido_por = auth.uid(), ativo = false, atualizado_em = now()
   WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (a.company_id, auth.uid(), 'erp_hub_frota_veiculo', p_id::text, 'excluir', jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_hub_frota_veiculo_restaurar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.erp_hub_frota_veiculo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  IF a.excluido_em IS NULL THEN RAISE EXCEPTION 'Este veículo já está ativo.'; END IF;
  IF EXISTS (SELECT 1 FROM public.erp_hub_frota_veiculo o WHERE o.company_id = a.company_id AND o.placa = a.placa AND o.excluido_em IS NULL) THEN
    RAISE EXCEPTION 'Já existe um veículo ativo com a placa %. Exclua o outro antes de restaurar este.', a.placa;
  END IF;
  UPDATE public.erp_hub_frota_veiculo SET excluido_em = NULL, excluido_por = NULL, ativo = true, atualizado_em = now() WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (a.company_id, auth.uid(), 'erp_hub_frota_veiculo', p_id::text, 'restaurar', jsonb_build_object('motivo', btrim(coalesce(p_motivo, ''))));
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- 5c) plano preventivo: definir/editar o intervalo por tipo
CREATE OR REPLACE FUNCTION public.fn_hub_frota_manutencao_plano_salvar(
  p_veiculo_id uuid, p_tipo text, p_intervalo_km numeric, p_observacao text DEFAULT NULL,
  p_ultimo_km numeric DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v record; v_id uuid; v_km_atual numeric;
BEGIN
  SELECT * INTO v FROM public.erp_hub_frota_veiculo WHERE id = p_veiculo_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado (ou excluído).'; END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  IF length(btrim(coalesce(p_tipo, ''))) = 0 THEN RAISE EXCEPTION 'Informe o tipo da manutenção (ex.: troca de óleo, pneus).'; END IF;
  IF coalesce(p_intervalo_km, 0) <= 0 THEN RAISE EXCEPTION 'Informe a cada quantos km a manutenção deve ser feita (maior que zero).'; END IF;
  IF p_id IS NULL THEN
    -- primeira vez: a contagem começa do km atual (ou do km informado, se a pessoa já sabe a última troca)
    IF p_ultimo_km IS NULL THEN
      SELECT (public.fn_hub_frota_indicadores(v.company_id, v.id)->'veiculos'->0->>'km_atual')::numeric INTO v_km_atual;
    END IF;
    INSERT INTO public.erp_hub_frota_manutencao_plano (company_id, veiculo_id, tipo, intervalo_km, ultimo_km, observacao)
    VALUES (v.company_id, v.id, btrim(p_tipo), p_intervalo_km, coalesce(p_ultimo_km, v_km_atual, v.km_inicial), nullif(btrim(p_observacao), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_hub_frota_manutencao_plano SET
      tipo = btrim(p_tipo), intervalo_km = p_intervalo_km,
      ultimo_km = coalesce(p_ultimo_km, ultimo_km), observacao = nullif(btrim(p_observacao), ''), atualizado_em = now()
     WHERE id = p_id AND veiculo_id = v.id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Plano não encontrado (ou excluído).'; END IF;
  END IF;
  RETURN v_id;
END
$function$;

-- 5d) manutenção feita: grava o registro e recomeça a contagem do plano daquele tipo
CREATE OR REPLACE FUNCTION public.fn_hub_frota_manutencao_registrar(p_veiculo_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v record; v_id uuid; v_tipo text; v_km numeric;
BEGIN
  SELECT * INTO v FROM public.erp_hub_frota_veiculo WHERE id = p_veiculo_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Veículo não encontrado (ou excluído).'; END IF;
  PERFORM public.fn__guarda_empresa(v.company_id);
  v_tipo := btrim(coalesce(p_dados->>'tipo', ''));
  v_km := nullif(p_dados->>'km_na_manutencao', '')::numeric;
  IF v_tipo = '' THEN RAISE EXCEPTION 'Informe o tipo da manutenção feita.'; END IF;
  IF v_km IS NULL OR v_km < 0 THEN RAISE EXCEPTION 'Informe o km do veículo na hora da manutenção.'; END IF;
  INSERT INTO public.erp_hub_frota_manutencao_registro (company_id, veiculo_id, tipo, data, km_na_manutencao, valor, fornecedor, descricao, anexo_path)
  VALUES (v.company_id, v.id, v_tipo, coalesce(nullif(p_dados->>'data', '')::date, current_date), v_km,
          nullif(p_dados->>'valor', '')::numeric, nullif(btrim(p_dados->>'fornecedor'), ''),
          nullif(btrim(p_dados->>'descricao'), ''), nullif(btrim(p_dados->>'anexo_path'), ''))
  RETURNING id INTO v_id;
  -- o alerta daquele tipo zera e recomeça a contar a partir deste km
  UPDATE public.erp_hub_frota_manutencao_plano SET ultimo_km = v_km, atualizado_em = now()
   WHERE veiculo_id = v.id AND lower(tipo) = lower(v_tipo) AND excluido_em IS NULL;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (v.company_id, auth.uid(), 'erp_hub_frota_manutencao_registro', v_id::text, 'registrar', jsonb_build_object('tipo', v_tipo, 'km', v_km));
  RETURN v_id;
END
$function$;

-- 5e) manutenção registrada: excluir (rastreável). O plano volta ao último km que ainda existe para aquele tipo.
CREATE OR REPLACE FUNCTION public.fn_hub_frota_manutencao_excluir(p_registro_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.erp_hub_frota_manutencao_registro WHERE id = p_registro_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manutenção não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(r.company_id);
  IF r.excluido_em IS NOT NULL THEN RAISE EXCEPTION 'Esta manutenção já foi excluída.'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  UPDATE public.erp_hub_frota_manutencao_registro SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_registro_id;
  UPDATE public.erp_hub_frota_manutencao_plano p SET
      ultimo_km = coalesce((SELECT max(m.km_na_manutencao) FROM public.erp_hub_frota_manutencao_registro m
                             WHERE m.veiculo_id = r.veiculo_id AND lower(m.tipo) = lower(r.tipo) AND m.excluido_em IS NULL), p.ultimo_km),
      atualizado_em = now()
   WHERE p.veiculo_id = r.veiculo_id AND lower(p.tipo) = lower(r.tipo) AND p.excluido_em IS NULL;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (r.company_id, auth.uid(), 'erp_hub_frota_manutencao_registro', p_registro_id::text, 'excluir', jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- Permissões: nenhuma RPC aberta ao anon/PUBLIC (IDOR); authenticated e service_role só.
REVOKE ALL ON FUNCTION public.fn_hub_frota_indicadores(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_indicadores(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_veiculo_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_veiculo_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_veiculo_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_veiculo_excluir(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_veiculo_restaurar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_veiculo_restaurar(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_manutencao_plano_salvar(uuid, text, numeric, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_manutencao_plano_salvar(uuid, text, numeric, text, numeric, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_manutencao_registrar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_manutencao_registrar(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_manutencao_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_manutencao_excluir(uuid, text) TO authenticated, service_role;

-- 6) TELA: catálogo, origem do dado (RD-98 pilar 3) e botões ------------------------------------------------------
INSERT INTO public.module_catalog (id, nome, rota, ativo, grupo, icone, layer, ordem, so_ps, legacy, subgrupo, descricao, is_shared, surface_in_groups)
SELECT 'projetos_frota', 'Controle de frota', '/dashboard/projetos/frota', true, 'hub', '🚚', '2_svc', 124, false, false,
       'projetos_engenharia', 'Veículos, plano de manutenção preventiva (km), histórico e consumo. Km e abastecimento vêm das viagens.',
       false, ARRAY['hub']
WHERE NOT EXISTS (SELECT 1 FROM public.module_catalog WHERE id = 'projetos_frota');

INSERT INTO public.system_screens (id, area, rota, titulo, descricao_funcional, estado_real, prioridade_monitoramento, auditavel_robo,
                                   views_consumidas, rpcs_chamadas)
SELECT 'dashboard.projetos_frota', 'hub_construcao', '/dashboard/projetos/frota', 'Controle de frota',
       'Veículos, plano de manutenção preventiva por km e histórico. Km e consumo vêm das viagens lançadas.', 'parcial', 'media', true,
       ARRAY['erp_viagem', 'erp_viagem_lancamento', 'erp_hub_frota_veiculo', 'erp_hub_frota_manutencao_plano', 'erp_hub_frota_manutencao_registro'],
       ARRAY['fn_hub_frota_indicadores', 'fn_hub_frota_veiculo_salvar', 'fn_hub_frota_veiculo_excluir', 'fn_hub_frota_veiculo_restaurar',
             'fn_hub_frota_manutencao_plano_salvar', 'fn_hub_frota_manutencao_registrar', 'fn_hub_frota_manutencao_excluir']
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE id = 'dashboard.projetos_frota');

INSERT INTO public.gold_screen_buttons (screen_id, rota, botao_label, botao_selector_css, destino_esperado_rota, destino_esperado_descricao, prioridade, tipo, ativo)
SELECT 'dashboard.projetos_frota', '/dashboard/projetos/frota', 'Novo veículo', '[data-testid="frota-novo-veiculo"]', NULL,
       'Abre o cadastro do veículo com o plano preventivo na mesma tela.', 'normal', 'acao', true
WHERE NOT EXISTS (SELECT 1 FROM public.gold_screen_buttons WHERE screen_id = 'dashboard.projetos_frota' AND botao_label = 'Novo veículo');

-- 7) AJUDA DE CAMPO (RD-95): o "?" de cada campo da tela, textos no banco --------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.frota.placa', '/dashboard/projetos/frota', 'Frota', 'Placa',
   'A placa do veículo, sem traço (ex.: DEM1A01).', 'Liga o veículo às viagens: é pela placa que o km e o abastecimento são somados.',
   'DEM1A01 (7 letras e números)', 'Placa diferente da que está no documento do veículo.', 'hub', 910, 1, 'publicado'),
  ('projetos.frota.km_inicial', '/dashboard/projetos/frota', 'Frota', 'Km inicial',
   'O km que o veículo marcava quando foi cadastrado.', 'Base para o km do veículo antes das primeiras viagens. Depois o km passa a vir das viagens.',
   '18730', 'Digitar o km atual em vez do km de quando cadastrou (o km vem das viagens de qualquer forma).', 'hub', 911, 1, 'publicado'),
  ('projetos.frota.modelo', '/dashboard/projetos/frota', 'Frota', 'Modelo',
   'O modelo do veículo.', 'Identifica o veículo na lista.', 'Strada Working', 'Deixar em branco: a lista fica sem nome.', 'hub', 912, 1, 'publicado'),
  ('projetos.frota.marca', '/dashboard/projetos/frota', 'Frota', 'Marca',
   'A marca do veículo.', 'Identifica o veículo na lista.', 'Fiat', 'Repetir o modelo no campo marca.', 'hub', 913, 1, 'publicado'),
  ('projetos.frota.ano', '/dashboard/projetos/frota', 'Frota', 'Ano',
   'O ano de fabricação do veículo.', 'Consulta futura e identificação.', '2021', 'Ano do modelo em vez do ano de fabricação.', 'hub', 914, 1, 'publicado'),
  ('projetos.frota.tipo', '/dashboard/projetos/frota', 'Frota', 'Tipo',
   'O tipo do veículo: carro, caminhonete, caminhão ou moto.', 'Organiza a frota na lista.', 'Caminhonete', 'Escolher carro para um caminhão.', 'hub', 915, 1, 'publicado'),
  ('projetos.frota.chassi', '/dashboard/projetos/frota', 'Frota', 'Chassi',
   'O número do chassi, se quiser guardar (opcional).', 'Documento do veículo, não é obrigatório para controlar a manutenção.', '9BWZZZ377VT004251', 'Digitar o RENAVAM neste campo.', 'hub', 916, 1, 'publicado'),
  ('projetos.frota.renavam', '/dashboard/projetos/frota', 'Frota', 'RENAVAM',
   'O RENAVAM do veículo, se quiser guardar (opcional).', 'Documento do veículo, não é obrigatório para controlar a manutenção.', '01234567890', 'Digitar o chassi neste campo.', 'hub', 917, 1, 'publicado'),
  ('projetos.frota.intervalo_km', '/dashboard/projetos/frota', 'Frota', 'A cada quantos km',
   'De quantos em quantos km esta manutenção deve ser feita (ex.: troca de óleo a cada 10.000 km).',
   'O sistema calcula quando vence: a partir do km atual e da última vez que foi feita.', '10000', 'Colocar o total de km em vez do intervalo entre trocas (ex.: 100000 em vez de 10000).', 'hub', 918, 1, 'publicado'),
  ('projetos.frota.tipo_manutencao', '/dashboard/projetos/frota', 'Frota', 'Tipo de manutenção',
   'O nome da manutenção preventiva (troca de óleo, pneus, revisão, freios…).', 'Cada tipo tem o seu próprio contador de km.', 'Troca de óleo', 'Usar o mesmo nome com grafias diferentes: vira duas manutenções.', 'hub', 919, 1, 'publicado'),
  ('projetos.frota.ultimo_km', '/dashboard/projetos/frota', 'Frota', 'Última vez (km)',
   'O km em que esta manutenção foi feita pela última vez (opcional).', 'Se não souber, o contador começa do km atual.', '45000', 'Informar o km de hoje quando a troca foi há muito tempo: o alerta fica atrasado.', 'hub', 920, 1, 'publicado'),
  ('projetos.frota.km_manutencao', '/dashboard/projetos/frota', 'Frota', 'Km na manutenção',
   'O km do veículo no dia em que a manutenção foi feita.', 'É daqui que o contador da próxima manutenção começa.', '45460', 'Km da próxima viagem em vez do km da hora da manutenção.', 'hub', 921, 1, 'publicado'),
  ('projetos.frota.valor', '/dashboard/projetos/frota', 'Frota', 'Valor',
   'Quanto custou a manutenção (opcional).', 'Soma o custo de manutenção por veículo.', '850,00', 'Colocar o valor com vírgula e ponto juntos (use só um dos dois).', 'hub', 922, 1, 'publicado'),
  ('projetos.frota.fornecedor', '/dashboard/projetos/frota', 'Frota', 'Fornecedor',
   'Onde a manutenção foi feita (opcional).', 'Histórico: quem fez cada manutenção.', 'Oficina Central', 'Deixar em branco quando a oficina é conhecida.', 'hub', 923, 1, 'publicado'),
  ('projetos.frota.consumo', '/dashboard/projetos/frota', 'Frota', 'Consumo (km/litro)',
   'Calculado: km percorrido nas viagens dividido pelos litros abastecidos.', 'Mostra quanto o veículo rende. Sem abastecimento lançado, não aparece.', '4,6 km/l', 'Achar que está errado: confira se os abastecimentos estão lançados na viagem.', 'hub', 924, 1, 'publicado'),
  ('projetos.frota.km_atual', '/dashboard/projetos/frota', 'Frota', 'Km atual',
   'Calculado: o maior km conhecido do veículo (viagens, abastecimentos, manutenções e km inicial).', 'É a base de todos os alertas de manutenção.', '45498 km', 'Esperar que o km mude sem lançar nenhuma viagem: o km só sobe com viagens ou manutenções.', 'hub', 925, 1, 'publicado'),
  ('projetos.frota.data_manutencao', '/dashboard/projetos/frota', 'Frota', 'Data da manutenção',
   'A data em que a manutenção foi feita (o padrão é hoje).', 'Ordena o histórico e mostra quando a troca aconteceu.', '15/10/2026', 'Usar a data do orçamento em vez da data da execução.', 'hub', 927, 1, 'publicado'),
  ('projetos.frota.descricao', '/dashboard/projetos/frota', 'Frota', 'Descrição',
   'O que foi feito, em poucas palavras (opcional).', 'Ajuda a lembrar o serviço no histórico.', 'Troca de óleo 5W30 + filtro', 'Repetir o tipo da manutenção sem detalhar o serviço.', 'hub', 928, 1, 'publicado'),
  ('projetos.frota.motivo_exclusao', '/dashboard/projetos/frota', 'Frota', 'Motivo da exclusão',
   'Por que o veículo ou a manutenção está sendo excluído.', 'Fica registrado na auditoria: quem excluiu, quando e por quê.', 'vendido', 'Deixar em branco: a exclusão não é aceita sem motivo.', 'hub', 929, 1, 'publicado'),
  ('projetos.frota.alerta', '/dashboard/projetos/frota', 'Frota', 'Alerta de manutenção',
   'Calculado: verde = faltam mais de 20% do intervalo; amarelo = faltam até 20%; vermelho = venceu.', 'Mostra o que precisa de atenção antes de quebrar.', 'Vermelho: troca de óleo vencida há 500 km', 'Ignorar o vermelho: ele some só quando a manutenção é registrada.', 'hub', 926, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
