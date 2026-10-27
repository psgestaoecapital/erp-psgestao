-- Hub · Frota · custos completos do veículo, documentos com vencimento e anexos (#5166 evolução, #5175).
-- RD-26: reaproveita o padrão de veic_veiculo / veic_custo (revenda), sem acoplar as tabelas veic_*.
-- Migration ADITIVA: colunas novas em erp_hub_frota_veiculo, 2 tabelas novas, bucket privado, RPCs novas e
-- CREATE OR REPLACE de fn_hub_frota_indicadores (mesma assinatura, ganha custo, custo por km e alerta de documento).
-- Prioridade de monitoramento: só critica/alta/media/baixa (lição do deploy de hoje).

-- 1) VEÍCULO: campos técnicos, aquisição e CRLV (todos opcionais; os veículos DEMO continuam válidos) ----------------
ALTER TABLE public.erp_hub_frota_veiculo
  ADD COLUMN IF NOT EXISTS versao           text,
  ADD COLUMN IF NOT EXISTS cor              text,
  ADD COLUMN IF NOT EXISTS combustivel      text,
  ADD COLUMN IF NOT EXISTS cambio           text,
  ADD COLUMN IF NOT EXISTS potencia_cv      integer CHECK (potencia_cv IS NULL OR potencia_cv > 0),
  ADD COLUMN IF NOT EXISTS lugares          integer CHECK (lugares IS NULL OR lugares > 0),
  ADD COLUMN IF NOT EXISTS ncm              text,
  ADD COLUMN IF NOT EXISTS valor_aquisicao  numeric CHECK (valor_aquisicao IS NULL OR valor_aquisicao >= 0),
  ADD COLUMN IF NOT EXISTS data_entrada     date,
  ADD COLUMN IF NOT EXISTS fornecedor_nome  text,
  ADD COLUMN IF NOT EXISTS crlv_path        text,
  ADD COLUMN IF NOT EXISTS tem_manual       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tem_chave_reserva boolean NOT NULL DEFAULT false;

-- 2) CUSTOS DO VEÍCULO (espelha veic_custo, com exclusão rastreável RD-98) -----------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_hub_frota_custo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id        uuid NOT NULL REFERENCES public.erp_hub_frota_veiculo(id) ON DELETE CASCADE,
  categoria         text NOT NULL DEFAULT 'outro' CHECK (length(btrim(categoria)) > 0),
  descricao         text,
  valor             numeric NOT NULL CHECK (valor >= 0),
  fornecedor_nome   text,
  data_custo        date NOT NULL DEFAULT current_date,
  documento         text,
  anexo_path        text,
  entra_base_fiscal boolean NOT NULL DEFAULT false,
  pagar_id          uuid,
  observacao        text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  criado_por        uuid DEFAULT auth.uid(),
  excluido_em       timestamptz,
  excluido_por      uuid
);
CREATE INDEX IF NOT EXISTS ix_hub_frota_custo_veiculo
  ON public.erp_hub_frota_custo (veiculo_id, data_custo) WHERE excluido_em IS NULL;

-- 3) DOCUMENTOS COM VENCIMENTO (IPVA, seguro, licenciamento) — alerta por DATA ----------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_hub_frota_documento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  veiculo_id    uuid NOT NULL REFERENCES public.erp_hub_frota_veiculo(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('ipva', 'seguro', 'licenciamento', 'outro')),
  vencimento    date NOT NULL,
  valor         numeric CHECK (valor IS NULL OR valor >= 0),
  anexo_path    text,
  observacao    text,
  renovado_em   timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid DEFAULT auth.uid(),
  excluido_em   timestamptz,
  excluido_por  uuid
);
CREATE INDEX IF NOT EXISTS ix_hub_frota_documento_veiculo
  ON public.erp_hub_frota_documento (veiculo_id, vencimento) WHERE excluido_em IS NULL;

-- RLS: leitura por empresa; escrita SÓ pelas RPCs (mesmo padrão das tabelas da frota).
ALTER TABLE public.erp_hub_frota_custo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_hub_frota_documento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hub_frota_custo_sel ON public.erp_hub_frota_custo;
CREATE POLICY hub_frota_custo_sel ON public.erp_hub_frota_custo FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS hub_frota_documento_sel ON public.erp_hub_frota_documento;
CREATE POLICY hub_frota_documento_sel ON public.erp_hub_frota_documento FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.erp_hub_frota_custo, public.erp_hub_frota_documento FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_hub_frota_custo, public.erp_hub_frota_documento FROM authenticated;
GRANT SELECT ON public.erp_hub_frota_custo, public.erp_hub_frota_documento TO authenticated;
GRANT ALL ON public.erp_hub_frota_custo, public.erp_hub_frota_documento TO service_role;

-- 4) ANEXOS: bucket privado; o caminho começa pelo id da empresa (<company_id>/frota/...) --------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('frota-anexos', 'frota-anexos', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS frota_anexos_sel ON storage.objects;
CREATE POLICY frota_anexos_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'frota-anexos' AND (storage.foldername(name))[1] IN (SELECT (public.get_user_company_ids())::text));
DROP POLICY IF EXISTS frota_anexos_ins ON storage.objects;
CREATE POLICY frota_anexos_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'frota-anexos' AND (storage.foldername(name))[1] IN (SELECT (public.get_user_company_ids())::text));

-- Caminho do anexo tem de começar pela empresa (quem grava não escolhe a pasta de outra empresa).
CREATE OR REPLACE FUNCTION public.fn__frota_anexo_ok(p_company uuid, p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT p_path IS NULL OR p_path LIKE (p_company::text || '/%');
$function$;

-- 5) RPCs DE CUSTO ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_hub_frota_custo_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_veic uuid; v_valor numeric; v_anexo text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_veic := nullif(p_dados->>'veiculo_id', '')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.erp_hub_frota_veiculo WHERE id = v_veic AND company_id = p_company_id AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'Veículo não encontrado nesta empresa (ou excluído).';
  END IF;
  v_valor := nullif(p_dados->>'valor', '')::numeric;
  IF v_valor IS NULL OR v_valor < 0 THEN RAISE EXCEPTION 'Informe o valor do custo (zero ou mais).'; END IF;
  v_anexo := nullif(btrim(p_dados->>'anexo_path'), '');
  IF NOT public.fn__frota_anexo_ok(p_company_id, v_anexo) THEN RAISE EXCEPTION 'Anexo fora da pasta desta empresa.'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.erp_hub_frota_custo (company_id, veiculo_id, categoria, descricao, valor, fornecedor_nome, data_custo,
                                            documento, anexo_path, entra_base_fiscal, observacao)
    VALUES (p_company_id, v_veic, coalesce(nullif(btrim(p_dados->>'categoria'), ''), 'outro'), nullif(btrim(p_dados->>'descricao'), ''),
            v_valor, nullif(btrim(p_dados->>'fornecedor_nome'), ''), coalesce(nullif(p_dados->>'data_custo', '')::date, current_date),
            nullif(btrim(p_dados->>'documento'), ''), v_anexo, coalesce((p_dados->>'entra_base_fiscal')::boolean, false),
            nullif(btrim(p_dados->>'observacao'), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_hub_frota_custo SET
      veiculo_id = v_veic, categoria = coalesce(nullif(btrim(p_dados->>'categoria'), ''), categoria),
      descricao = nullif(btrim(p_dados->>'descricao'), ''), valor = v_valor,
      fornecedor_nome = nullif(btrim(p_dados->>'fornecedor_nome'), ''),
      data_custo = coalesce(nullif(p_dados->>'data_custo', '')::date, data_custo),
      documento = nullif(btrim(p_dados->>'documento'), ''), anexo_path = v_anexo,
      entra_base_fiscal = coalesce((p_dados->>'entra_base_fiscal')::boolean, entra_base_fiscal),
      observacao = nullif(btrim(p_dados->>'observacao'), '')
     WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Custo não encontrado (ou excluído).'; END IF;
  END IF;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_hub_frota_custo', v_id::text, 'salvar_custo', jsonb_build_object('valor', v_valor, 'categoria', p_dados->>'categoria'));
  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_hub_frota_custo_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.erp_hub_frota_custo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Custo não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  IF a.excluido_em IS NOT NULL THEN RAISE EXCEPTION 'Este custo já está excluído.'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  UPDATE public.erp_hub_frota_custo SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (a.company_id, auth.uid(), 'erp_hub_frota_custo', p_id::text, 'excluir', jsonb_build_object('motivo', btrim(p_motivo), 'valor', a.valor));
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_hub_frota_custo_restaurar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.erp_hub_frota_custo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Custo não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  IF a.excluido_em IS NULL THEN RAISE EXCEPTION 'Este custo já está ativo.'; END IF;
  UPDATE public.erp_hub_frota_custo SET excluido_em = NULL, excluido_por = NULL WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (a.company_id, auth.uid(), 'erp_hub_frota_custo', p_id::text, 'restaurar', jsonb_build_object('motivo', btrim(coalesce(p_motivo, ''))));
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- 6) RPCS DE DOCUMENTO (IPVA, seguro, licenciamento) -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_hub_frota_documento_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_veic uuid; v_anexo text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_veic := nullif(p_dados->>'veiculo_id', '')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.erp_hub_frota_veiculo WHERE id = v_veic AND company_id = p_company_id AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'Veículo não encontrado nesta empresa (ou excluído).';
  END IF;
  IF nullif(p_dados->>'vencimento', '') IS NULL THEN RAISE EXCEPTION 'Informe o vencimento do documento.'; END IF;
  v_anexo := nullif(btrim(p_dados->>'anexo_path'), '');
  IF NOT public.fn__frota_anexo_ok(p_company_id, v_anexo) THEN RAISE EXCEPTION 'Anexo fora da pasta desta empresa.'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.erp_hub_frota_documento (company_id, veiculo_id, tipo, vencimento, valor, anexo_path, observacao)
    VALUES (p_company_id, v_veic, coalesce(nullif(p_dados->>'tipo', ''), 'outro'), (p_dados->>'vencimento')::date,
            nullif(p_dados->>'valor', '')::numeric, v_anexo, nullif(btrim(p_dados->>'observacao'), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_hub_frota_documento SET
      veiculo_id = v_veic, tipo = coalesce(nullif(p_dados->>'tipo', ''), tipo), vencimento = (p_dados->>'vencimento')::date,
      valor = nullif(p_dados->>'valor', '')::numeric, anexo_path = coalesce(v_anexo, anexo_path),
      observacao = nullif(btrim(p_dados->>'observacao'), '')
     WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado (ou excluído).'; END IF;
  END IF;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_hub_frota_documento', v_id::text, 'salvar_documento', jsonb_build_object('tipo', p_dados->>'tipo'));
  RETURN v_id;
END
$function$;

-- Renovar: novo vencimento (e valor/anexo da renovação). Registra a data da renovação.
CREATE OR REPLACE FUNCTION public.fn_hub_frota_documento_renovar(p_id uuid, p_vencimento date, p_valor numeric DEFAULT NULL, p_anexo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.erp_hub_frota_documento WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  IF a.excluido_em IS NOT NULL THEN RAISE EXCEPTION 'Este documento está excluído.'; END IF;
  IF p_vencimento IS NULL THEN RAISE EXCEPTION 'Informe o novo vencimento.'; END IF;
  IF NOT public.fn__frota_anexo_ok(a.company_id, p_anexo) THEN RAISE EXCEPTION 'Anexo fora da pasta desta empresa.'; END IF;
  UPDATE public.erp_hub_frota_documento SET vencimento = p_vencimento, valor = coalesce(p_valor, valor),
         anexo_path = coalesce(nullif(btrim(p_anexo), ''), anexo_path), renovado_em = now()
   WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (a.company_id, auth.uid(), 'erp_hub_frota_documento', p_id::text, 'renovar_documento', jsonb_build_object('de', a.vencimento, 'para', p_vencimento));
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_hub_frota_documento_excluir(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.erp_hub_frota_documento WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado.'; END IF;
  PERFORM public.fn__guarda_empresa(a.company_id);
  IF a.excluido_em IS NOT NULL THEN RAISE EXCEPTION 'Este documento já está excluído.'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  UPDATE public.erp_hub_frota_documento SET excluido_em = now(), excluido_por = auth.uid() WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
    VALUES (a.company_id, auth.uid(), 'erp_hub_frota_documento', p_id::text, 'excluir', jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END
$function$;

-- 7) INDICADORES: + custo (manutenção e combustível), custo por km e alerta de documento por data --------------------
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
      SELECT upper(regexp_replace(placa, '[^A-Za-z0-9]', '', 'g')) AS placa_n, hodometro, litros, valor
        FROM public.erp_viagem_lancamento
       WHERE company_id = p_company_id AND excluido_em IS NULL AND placa IS NOT NULL
         AND (tipo = 'abastecimento' OR tipo_despesa = 'combustivel')
    ),
    km_abast AS (
      SELECT placa_n, max(hodometro) AS km_max, sum(litros) AS litros, sum(valor) AS custo_comb FROM abast GROUP BY placa_n
    ),
    km_reg AS (
      SELECT veiculo_id, max(km_na_manutencao) AS km_max
        FROM public.erp_hub_frota_manutencao_registro
       WHERE company_id = p_company_id AND excluido_em IS NULL GROUP BY veiculo_id
    ),
    custos AS (
      SELECT veiculo_id, sum(valor) AS custo_manut
        FROM public.erp_hub_frota_custo
       WHERE company_id = p_company_id AND excluido_em IS NULL GROUP BY veiculo_id
    ),
    docs AS (
      SELECT d.veiculo_id,
             jsonb_agg(jsonb_build_object(
               'id', d.id, 'tipo', d.tipo, 'vencimento', d.vencimento, 'valor', d.valor, 'anexo_path', d.anexo_path,
               'dias', d.vencimento - current_date,
               'status', CASE WHEN d.vencimento < current_date THEN 'vermelho'
                              WHEN d.vencimento <= current_date + 30 THEN 'amarelo'
                              ELSE 'verde' END
             ) ORDER BY d.vencimento) AS documentos,
             count(*) FILTER (WHERE d.vencimento < current_date) AS docs_vencidos,
             count(*) FILTER (WHERE d.vencimento >= current_date AND d.vencimento <= current_date + 30) AS docs_amarelos
        FROM public.erp_hub_frota_documento d
       WHERE d.company_id = p_company_id AND d.excluido_em IS NULL
       GROUP BY d.veiculo_id
    ),
    base AS (
      SELECT v.id, v.placa, v.modelo, v.marca, v.ano, v.tipo,
             GREATEST(v.km_inicial, kv.km_max, ka.km_max, kr.km_max) AS km_atual,
             coalesce(kv.km_perc, 0) AS km_percorrido,
             coalesce(ka.litros, 0) AS litros,
             coalesce(ka.custo_comb, 0) AS custo_combustivel,
             coalesce(cu.custo_manut, 0) AS custo_manutencao,
             CASE WHEN coalesce(ka.litros, 0) > 0 THEN round(coalesce(kv.km_perc, 0) / ka.litros, 2) END AS consumo_km_l
        FROM v
        LEFT JOIN km_viag kv ON kv.placa_n = v.placa
        LEFT JOIN km_abast ka ON ka.placa_n = v.placa
        LEFT JOIN km_reg kr ON kr.veiculo_id = v.id
        LEFT JOIN custos cu ON cu.veiculo_id = v.id
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
                  ELSE 'sem_plano' END AS status_geral,
             dc.documentos, coalesce(dc.docs_vencidos, 0) AS docs_vencidos, coalesce(dc.docs_amarelos, 0) AS docs_amarelos,
             CASE WHEN coalesce(dc.docs_vencidos, 0) > 0 THEN 'vermelho'
                  WHEN coalesce(dc.docs_amarelos, 0) > 0 THEN 'amarelo'
                  WHEN dc.documentos IS NOT NULL THEN 'verde'
                  ELSE 'sem_doc' END AS status_docs,
             (b.custo_manutencao + b.custo_combustivel) AS custo_total,
             CASE WHEN b.km_percorrido > 0 THEN round((b.custo_manutencao + b.custo_combustivel) / b.km_percorrido, 2) END AS custo_por_km
        FROM base b
        LEFT JOIN pl ON pl.veiculo_id = b.id
        LEFT JOIN docs dc ON dc.veiculo_id = b.id
    )
    SELECT jsonb_build_object(
      'resumo', jsonb_build_object(
        'total_veiculos', (SELECT count(*) FROM veic),
        'veiculos_vencidos', (SELECT count(*) FROM veic WHERE vencidos > 0),
        'documentos_vencidos', (SELECT count(*) FROM veic WHERE docs_vencidos > 0),
        'consumo_medio_frota', (SELECT round(sum(km_percorrido) / nullif(sum(litros), 0), 2) FROM veic WHERE litros > 0),
        'custo_total_frota', (SELECT coalesce(sum(custo_total), 0) FROM veic),
        'custo_por_km_frota', (SELECT round(sum(custo_total) / nullif(sum(km_percorrido), 0), 2) FROM veic WHERE km_percorrido > 0)
      ),
      'veiculos', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'placa', x.placa, 'modelo', x.modelo, 'marca', x.marca, 'ano', x.ano, 'tipo', x.tipo,
          'km_atual', x.km_atual, 'km_percorrido', x.km_percorrido, 'litros', x.litros, 'consumo_km_l', x.consumo_km_l,
          'custo_manutencao', x.custo_manutencao, 'custo_combustivel', x.custo_combustivel,
          'custo_total', x.custo_total, 'custo_por_km', x.custo_por_km,
          'status_geral', x.status_geral, 'vencidos', x.vencidos, 'amarelos', x.amarelos,
          'planos', coalesce(x.planos, '[]'::jsonb),
          'status_docs', x.status_docs, 'docs_vencidos', x.docs_vencidos, 'docs_amarelos', x.docs_amarelos,
          'documentos', coalesce(x.documentos, '[]'::jsonb)
        ) ORDER BY x.vencidos DESC, x.amarelos DESC, x.docs_vencidos DESC, x.placa)
        FROM veic x
      ), '[]'::jsonb)
    )
  );
END
$function$;

-- Veículo: salvar passa a gravar os campos novos (cadastro "Mais dados" e CRLV). Mesma assinatura da versão de #5166.
CREATE OR REPLACE FUNCTION public.fn_hub_frota_veiculo_salvar(p_company_id uuid, p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_placa text; v_crlv text;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_placa := upper(regexp_replace(coalesce(p_dados->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_placa) < 6 THEN RAISE EXCEPTION 'Informe a placa do veículo (ex.: ABC1D23 ou ABC1234).'; END IF;
  v_crlv := nullif(btrim(p_dados->>'crlv_path'), '');
  IF NOT public.fn__frota_anexo_ok(p_company_id, v_crlv) THEN RAISE EXCEPTION 'Anexo fora da pasta desta empresa.'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.erp_hub_frota_veiculo (company_id, placa, modelo, marca, ano, tipo, chassi, renavam, km_inicial, observacao,
                                              versao, cor, combustivel, cambio, potencia_cv, lugares, ncm, valor_aquisicao,
                                              data_entrada, fornecedor_nome, crlv_path, tem_manual, tem_chave_reserva)
    VALUES (p_company_id, v_placa,
            nullif(btrim(p_dados->>'modelo'), ''), nullif(btrim(p_dados->>'marca'), ''),
            nullif(p_dados->>'ano', '')::integer, coalesce(nullif(p_dados->>'tipo', ''), 'carro'),
            nullif(btrim(p_dados->>'chassi'), ''), nullif(btrim(p_dados->>'renavam'), ''),
            coalesce(nullif(p_dados->>'km_inicial', '')::numeric, 0), nullif(btrim(p_dados->>'observacao'), ''),
            nullif(btrim(p_dados->>'versao'), ''), nullif(btrim(p_dados->>'cor'), ''),
            nullif(btrim(p_dados->>'combustivel'), ''), nullif(btrim(p_dados->>'cambio'), ''),
            nullif(p_dados->>'potencia_cv', '')::integer, nullif(p_dados->>'lugares', '')::integer,
            nullif(btrim(p_dados->>'ncm'), ''), nullif(p_dados->>'valor_aquisicao', '')::numeric,
            nullif(p_dados->>'data_entrada', '')::date, nullif(btrim(p_dados->>'fornecedor_nome'), ''),
            v_crlv, coalesce((p_dados->>'tem_manual')::boolean, false), coalesce((p_dados->>'tem_chave_reserva')::boolean, false))
    RETURNING id INTO v_id;
    INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (p_company_id, auth.uid(), 'erp_hub_frota_veiculo', v_id::text, 'criar', jsonb_build_object('placa', v_placa));
  ELSE
    UPDATE public.erp_hub_frota_veiculo SET
      placa = v_placa, modelo = nullif(btrim(p_dados->>'modelo'), ''), marca = nullif(btrim(p_dados->>'marca'), ''),
      ano = nullif(p_dados->>'ano', '')::integer, tipo = coalesce(nullif(p_dados->>'tipo', ''), tipo),
      chassi = nullif(btrim(p_dados->>'chassi'), ''), renavam = nullif(btrim(p_dados->>'renavam'), ''),
      km_inicial = coalesce(nullif(p_dados->>'km_inicial', '')::numeric, km_inicial),
      observacao = nullif(btrim(p_dados->>'observacao'), ''),
      versao = nullif(btrim(p_dados->>'versao'), ''), cor = nullif(btrim(p_dados->>'cor'), ''),
      combustivel = nullif(btrim(p_dados->>'combustivel'), ''), cambio = nullif(btrim(p_dados->>'cambio'), ''),
      potencia_cv = nullif(p_dados->>'potencia_cv', '')::integer, lugares = nullif(p_dados->>'lugares', '')::integer,
      ncm = nullif(btrim(p_dados->>'ncm'), ''), valor_aquisicao = nullif(p_dados->>'valor_aquisicao', '')::numeric,
      data_entrada = nullif(p_dados->>'data_entrada', '')::date, fornecedor_nome = nullif(btrim(p_dados->>'fornecedor_nome'), ''),
      crlv_path = coalesce(v_crlv, crlv_path),
      tem_manual = coalesce((p_dados->>'tem_manual')::boolean, tem_manual),
      tem_chave_reserva = coalesce((p_dados->>'tem_chave_reserva')::boolean, tem_chave_reserva),
      atualizado_em = now()
     WHERE id = p_id AND company_id = p_company_id AND excluido_em IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Veículo não encontrado (ou já excluído).'; END IF;
    INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
      VALUES (p_company_id, auth.uid(), 'erp_hub_frota_veiculo', v_id::text, 'editar', jsonb_build_object('placa', v_placa));
  END IF;
  RETURN v_id;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_hub_frota_veiculo_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_veiculo_salvar(uuid, uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn__frota_anexo_ok(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_hub_frota_custo_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_custo_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_custo_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_custo_excluir(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_custo_restaurar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_custo_restaurar(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_documento_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_documento_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_documento_renovar(uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_documento_renovar(uuid, date, numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_documento_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_documento_excluir(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_hub_frota_indicadores(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_frota_indicadores(uuid, uuid) TO authenticated, service_role;

-- 8) METADADOS DA TELA (RD-98 pilar 3: origem do dado) ------------------------------------------------------------------
UPDATE public.system_screens SET
  views_consumidas = ARRAY['erp_viagem', 'erp_viagem_lancamento', 'erp_hub_frota_veiculo', 'erp_hub_frota_manutencao_plano',
                           'erp_hub_frota_manutencao_registro', 'erp_hub_frota_custo', 'erp_hub_frota_documento'],
  rpcs_chamadas = ARRAY['fn_hub_frota_indicadores', 'fn_hub_frota_veiculo_salvar', 'fn_hub_frota_veiculo_excluir', 'fn_hub_frota_veiculo_restaurar',
                        'fn_hub_frota_manutencao_plano_salvar', 'fn_hub_frota_manutencao_registrar', 'fn_hub_frota_manutencao_excluir',
                        'fn_hub_frota_custo_salvar', 'fn_hub_frota_custo_excluir', 'fn_hub_frota_custo_restaurar',
                        'fn_hub_frota_documento_salvar', 'fn_hub_frota_documento_renovar', 'fn_hub_frota_documento_excluir']
WHERE id = 'dashboard.projetos_frota';

-- 9) AJUDA DE CAMPO (RD-95): o "?" dos campos novos, textos no banco -----------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.frota.custo_categoria', '/dashboard/projetos/frota', 'Frota', 'Categoria do custo',
   'Escolha o tipo do gasto: manutenção, pneu, combustível, IPVA, licenciamento, seguro, multa, documentação ou outro.',
   'Separa os custos no painel e no custo por km.', 'Pneu', 'Usar "outro" para tudo: o custo por tipo fica sem sentido.', 'hub', 931, 1, 'publicado'),
  ('projetos.frota.custo_valor', '/dashboard/projetos/frota', 'Frota', 'Valor do custo',
   'Quanto custou (zero ou mais).', 'Soma no custo total do veículo e no custo por km.', '850,00', 'Digitar o valor com ponto de milhar sem vírgula decimal.', 'hub', 932, 1, 'publicado'),
  ('projetos.frota.custo_data', '/dashboard/projetos/frota', 'Frota', 'Data do custo',
   'A data em que o gasto aconteceu (o padrão é hoje).', 'Mostra quando o custo foi feito.', '15/10/2026', 'Usar a data do pagamento em vez da data do serviço.', 'hub', 933, 1, 'publicado'),
  ('projetos.frota.custo_anexo', '/dashboard/projetos/frota', 'Frota', 'Anexo (nota ou comprovante)',
   'Arquivo PDF ou imagem da nota, recibo ou comprovante (até 10 MB).', 'Guarda o documento junto do custo, para consulta depois.', 'nota-fiscal-2041.pdf', 'Anexar uma foto ilegível: a nota precisa estar legível.', 'hub', 934, 1, 'publicado'),
  ('projetos.frota.custo_base_fiscal', '/dashboard/projetos/frota', 'Frota', 'Entra na base fiscal',
   'Marque se este custo entra na base de cálculo de impostos.', 'Ajuda o contador a separar o que é base fiscal.', 'Marcado', 'Marcar por padrão sem conferir com o contador.', 'hub', 935, 1, 'publicado'),
  ('projetos.frota.doc_tipo', '/dashboard/projetos/frota', 'Frota', 'Tipo do documento',
   'IPVA, seguro, licenciamento ou outro documento com vencimento.', 'Organiza os alertas de vencimento.', 'Seguro', 'Usar "outro" para o IPVA: perde a organização por tipo.', 'hub', 936, 1, 'publicado'),
  ('projetos.frota.doc_vencimento', '/dashboard/projetos/frota', 'Frota', 'Vencimento',
   'A data em que o documento vence.', 'O sistema avisa 30 dias antes (amarelo) e quando já venceu (vermelho).', '30/11/2026', 'Digitar a data de emissão em vez do vencimento.', 'hub', 937, 1, 'publicado'),
  ('projetos.frota.doc_anexo', '/dashboard/projetos/frota', 'Frota', 'Anexo do documento',
   'O PDF ou foto do documento (até 10 MB).', 'Guarda o documento no veículo para consulta.', 'apolice-2026.pdf', 'Anexar o documento de outro veículo.', 'hub', 938, 1, 'publicado'),
  ('projetos.frota.custo_km', '/dashboard/projetos/frota', 'Frota', 'Custo por km',
   'Calculado: (custos da manutenção + combustível) dividido pelo km rodado nas viagens.', 'Mostra quanto custa rodar cada veículo.', 'R$ 0,85/km', 'Achar que está errado: confira se as viagens têm o km final.', 'hub', 939, 1, 'publicado'),
  ('projetos.frota.valor_aquisicao', '/dashboard/projetos/frota', 'Frota', 'Valor de aquisição',
   'Quanto o veículo custou na compra (opcional).', 'Base para depreciação e patrimônio.', '120.000,00', 'Colocar o valor financiado em vez do valor à vista.', 'hub', 940, 1, 'publicado'),
  ('projetos.frota.data_entrada', '/dashboard/projetos/frota', 'Frota', 'Data de entrada na frota',
   'Quando o veículo entrou na frota (opcional).', 'Mostra há quanto tempo o veículo está na empresa.', '01/03/2024', 'Usar a data da nota fiscal.', 'hub', 941, 1, 'publicado'),
  ('projetos.frota.crlv', '/dashboard/projetos/frota', 'Frota', 'CRLV',
   'O PDF do CRLV (documento do veículo, opcional).', 'Guarda o documento oficial no cadastro.', 'crlv-2026.pdf', 'Anexar o CRLV de outro veículo.', 'hub', 942, 1, 'publicado'),
  ('projetos.frota.cambio', '/dashboard/projetos/frota', 'Frota', 'Câmbio',
   'Manual ou automático (opcional).', 'Ficha técnica do veículo.', 'Manual', 'Confundir com o tipo de combustível.', 'hub', 943, 1, 'publicado'),
  ('projetos.frota.combustivel', '/dashboard/projetos/frota', 'Frota', 'Combustível',
   'Diesel, gasolina, flex, etanol ou elétrico (opcional).', 'Ficha técnica do veículo.', 'Diesel', 'Escrever o tipo de óleo no campo.', 'hub', 944, 1, 'publicado'),
  ('projetos.frota.versao', '/dashboard/projetos/frota', 'Frota', 'Versão',
   'A versão ou acabamento do modelo (opcional).', 'Ficha técnica do veículo.', 'LT 1.4 Flex', 'Repetir o nome do modelo.', 'hub', 945, 1, 'publicado'),
  ('projetos.frota.cor', '/dashboard/projetos/frota', 'Frota', 'Cor',
   'A cor do veículo (opcional).', 'Identifica o veículo na frota.', 'Branco', 'Usar a cor do estofado.', 'hub', 946, 1, 'publicado'),
  ('projetos.frota.potencia', '/dashboard/projetos/frota', 'Frota', 'Potência (cv)',
   'A potência do motor em cavalos (opcional).', 'Ficha técnica do veículo.', '98', 'Digitar em kW no lugar de cv.', 'hub', 947, 1, 'publicado'),
  ('projetos.frota.lugares', '/dashboard/projetos/frota', 'Frota', 'Lugares',
   'Quantas pessoas cabem no veículo (opcional).', 'Ficha técnica do veículo.', '5', 'Contar o motorista duas vezes.', 'hub', 948, 1, 'publicado'),
  ('projetos.frota.ncm', '/dashboard/projetos/frota', 'Frota', 'NCM',
   'Código NCM do veículo para a nota fiscal (opcional).', 'Ajuda a emitir e conferir notas do veículo.', '8703.23.10', 'Digitar o código do modelo em vez do NCM.', 'hub', 949, 1, 'publicado'),
  ('projetos.frota.fornecedor_veiculo', '/dashboard/projetos/frota', 'Frota', 'Fornecedor do veículo',
   'De quem a empresa comprou o veículo (opcional).', 'Histórico de compra do veículo.', 'Concessionária Centro', 'Colocar o fabricante no lugar do fornecedor.', 'hub', 950, 1, 'publicado'),
  ('projetos.frota.manual', '/dashboard/projetos/frota', 'Frota', 'Tem manual',
   'Marque se o manual do veículo está na empresa.', 'Checklist de entrega do veículo.', 'Marcado', 'Marcar sem o manual estar guardado.', 'hub', 951, 1, 'publicado'),
  ('projetos.frota.chave_reserva', '/dashboard/projetos/frota', 'Frota', 'Tem chave reserva',
   'Marque se a chave reserva está na empresa.', 'Checklist de entrega do veículo.', 'Marcado', 'Marcar sem a chave estar guardada.', 'hub', 952, 1, 'publicado'),
  ('projetos.frota.custo_total', '/dashboard/projetos/frota', 'Frota', 'Custo total da frota',
   'Soma dos custos de manutenção, combustível e os lançados na aba Custos (sem os excluídos).', 'Mostra quanto a frota custa no período.', 'R$ 48.300,00', 'Achar que falta custo: o custo de combustível vem das viagens com abastecimento.', 'hub', 958, 1, 'publicado'),
  ('projetos.frota.custo_descricao','/dashboard/projetos/frota', 'Frota', 'Descrição do custo',
   'O que foi feito ou comprado (opcional).', 'Ajuda a lembrar do gasto na consulta.', 'Troca de pneus dianteiros', 'Deixar em branco quando há várias despesas diferentes.', 'hub', 953, 1, 'publicado'),
  ('projetos.frota.custo_fornecedor', '/dashboard/projetos/frota', 'Frota', 'Fornecedor do custo',
   'Quem cobrou o custo (opcional).', 'Histórico de fornecedores do veículo.', 'Oficina do Zé', 'Colocar o nome do motorista.', 'hub', 954, 1, 'publicado'),
  ('projetos.frota.custo_documento', '/dashboard/projetos/frota', 'Frota', 'Número da nota ou recibo',
   'O número do documento fiscal ou recibo (opcional).', 'Facilita achar a nota depois.', 'NF 004521', 'Digitar a chave de acesso inteira.', 'hub', 955, 1, 'publicado'),
  ('projetos.frota.doc_valor', '/dashboard/projetos/frota', 'Frota', 'Valor do documento',
   'Quanto custa o documento, por exemplo o valor do IPVA ou do seguro (opcional).', 'Mostra o gasto anual com o documento.', '1.250,00', 'Colocar o valor da parcela no lugar do valor total.', 'hub', 956, 1, 'publicado'),
  ('projetos.frota.doc_renovar', '/dashboard/projetos/frota', 'Frota', 'Novo vencimento',
   'A nova data de vencimento depois da renovação.', 'Atualiza o alerta do documento.', '30/11/2027', 'Colocar a data em que a renovação foi feita.', 'hub', 957, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
