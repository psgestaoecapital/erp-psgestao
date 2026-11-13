-- Hub > Financeiro > Permutas — FATIA 1a: modelo de dados + RPCs (CEO 12/11, contexto 74dfdb57). Piloto Trio (4 CNPJs),
-- genérico p/ qualquer construtora/incorporadora. Nada de permuta existia antes (auditado, RD-38).
-- Conceito: cada permuta é uma CONTA-CORRENTE DE IMÓVEL. A empresa recebe um imóvel (crédito = valor_permuta) e quita
-- por MATERIAL, SERVIÇO/MEDIÇÃO, DINHEIRO ou IMÓVEL. valor_atualizado = valor_permuta + reajuste CUB acumulado;
-- quitado = soma dos movimentos; saldo = valor_atualizado − quitado (saldo negativo = "pagou a mais").
-- Reusa obras do Hub (projetos_obras) por FK NULLable; o resto (medição/estoque/pagar) é referência solta (ref_tipo+ref_id)
-- que a FATIA 2 liga de verdade. SÓ LEITURA do resto do ERP; aditivo; RLS por empresa; soft-delete (RD-98).

-- ── 1) hub_permuta: o contrato de permuta por empresa ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_permuta (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id          uuid REFERENCES public.projetos_obras(id) ON DELETE SET NULL,
  contratante      text,
  ativo_descr      text NOT NULL CHECK (length(btrim(ativo_descr)) > 0),          -- ex. "Apto 1202 Amazon"
  tipo_contrato    text NOT NULL DEFAULT 'misto' CHECK (tipo_contrato IN ('100_dinheiro','100_permuta','misto')),
  pct_permuta      numeric,
  valor_permuta    numeric NOT NULL DEFAULT 0,
  valor_dinheiro   numeric NOT NULL DEFAULT 0,
  indice_reajuste  text,                                                          -- ex. "CUB-SC"
  data_base        date,
  status           text NOT NULL DEFAULT 'a_iniciar' CHECK (status IN ('a_iniciar','em_andamento','quitado','pagou_a_mais')),
  intragrupo       boolean NOT NULL DEFAULT false,                               -- permuta entre empresas do mesmo grupo (eliminada no consolidado)
  contrato_anexo   text,
  criado_por       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  deleted_by       uuid,
  delete_motivo    text
);
CREATE INDEX IF NOT EXISTS ix_hub_permuta_company ON public.hub_permuta (company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_hub_permuta_obra ON public.hub_permuta (obra_id) WHERE deleted_at IS NULL;

-- ── 2) hub_permuta_movimento: o que quitou a permuta (material/serviço/dinheiro/imóvel) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_permuta_movimento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permuta_id          uuid NOT NULL REFERENCES public.hub_permuta(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo                text NOT NULL CHECK (tipo IN ('material','servico','dinheiro','imovel')),
  competencia         date,                                                        -- mês de referência (1º dia do mês)
  valor               numeric NOT NULL DEFAULT 0,
  data                date,
  num_nota            text,
  cnpj_emissor        text,
  empresa_emissora_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,     -- a Trio emite de 4 CNPJs
  ref_tipo            text CHECK (ref_tipo IN ('erp_pagar','obra_medicao','estoque_mov')),  -- FATIA 2 liga de verdade
  ref_id              uuid,
  obs                 text,
  criado_por          uuid,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  deleted_by          uuid,
  delete_motivo       text
);
CREATE INDEX IF NOT EXISTS ix_hub_permuta_mov_permuta ON public.hub_permuta_movimento (permuta_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_hub_permuta_mov_company ON public.hub_permuta_movimento (company_id) WHERE deleted_at IS NULL;

-- ── 3) hub_permuta_reajuste: CUB acumulado por competência ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hub_permuta_reajuste (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permuta_id     uuid NOT NULL REFERENCES public.hub_permuta(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competencia    date NOT NULL,                                                    -- mês (1º dia)
  indice_valor   numeric,                                                          -- valor do índice (CUB) no mês
  valor_reajuste numeric NOT NULL DEFAULT 0,                                       -- reajuste do mês (R$)
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (permuta_id, competencia)
);
CREATE INDEX IF NOT EXISTS ix_hub_permuta_reaj_permuta ON public.hub_permuta_reajuste (permuta_id);

-- ── RLS: leitura por empresa; escrita só por RPC de líder (SECURITY DEFINER). Fail-closed. ─────────────────────
ALTER TABLE public.hub_permuta           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_permuta_movimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_permuta_reajuste  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_permuta, public.hub_permuta_movimento, public.hub_permuta_reajuste FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS hub_permuta_sel ON public.hub_permuta;
CREATE POLICY hub_permuta_sel ON public.hub_permuta FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS hub_permuta_mov_sel ON public.hub_permuta_movimento;
CREATE POLICY hub_permuta_mov_sel ON public.hub_permuta_movimento FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS hub_permuta_reaj_sel ON public.hub_permuta_reajuste;
CREATE POLICY hub_permuta_reaj_sel ON public.hub_permuta_reajuste FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.hub_permuta, public.hub_permuta_movimento, public.hub_permuta_reajuste TO authenticated;
GRANT ALL ON public.hub_permuta, public.hub_permuta_movimento, public.hub_permuta_reajuste TO service_role;

-- ── Helper de cálculo (uma permuta): valor_atualizado / quitado / saldo / status derivado. ────────────────────
CREATE OR REPLACE FUNCTION public.fn__permuta_calc(p_id uuid)
 RETURNS TABLE (valor_permuta numeric, reajuste_acum numeric, valor_atualizado numeric, quitado numeric, saldo numeric, status_calc text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH p AS (SELECT valor_permuta vp FROM public.hub_permuta WHERE id = p_id AND deleted_at IS NULL),
       r AS (SELECT COALESCE(sum(valor_reajuste),0) ra FROM public.hub_permuta_reajuste WHERE permuta_id = p_id),
       q AS (SELECT COALESCE(sum(valor),0) qt FROM public.hub_permuta_movimento WHERE permuta_id = p_id AND deleted_at IS NULL)
  SELECT p.vp, r.ra, p.vp + r.ra, q.qt, (p.vp + r.ra) - q.qt,
         CASE WHEN q.qt = 0 THEN 'a_iniciar'
              WHEN (p.vp + r.ra) - q.qt < -0.01 THEN 'pagou_a_mais'
              WHEN abs((p.vp + r.ra) - q.qt) <= 0.01 THEN 'quitado'
              ELSE 'em_andamento' END
  FROM p, r, q;
$function$;
REVOKE ALL ON FUNCTION public.fn__permuta_calc(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__permuta_calc(uuid) TO authenticated, service_role;

-- ── fn_permuta_listar(company_ids[]) — lista + KPIs, só das empresas que o usuário pode ver (fail-closed) ──────
CREATE OR REPLACE FUNCTION public.fn_permuta_listar(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_allowed uuid[]; v_out jsonb;
BEGIN
  SELECT array_agg(c) INTO v_allowed FROM unnest(COALESCE(p_company_ids,'{}')) c
   WHERE public.is_admin() OR c IN (SELECT public.get_user_company_ids());
  IF v_allowed IS NULL OR cardinality(v_allowed) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_empresa');
  END IF;
  WITH base AS (
    SELECT pm.*, c.valor_atualizado, c.quitado, c.saldo, c.reajuste_acum, c.status_calc,
           coalesce(ob.nome, '') obra_nome,
           coalesce(ce.nome_fantasia, ce.razao_social) emp_nome
    FROM public.hub_permuta pm
    LEFT JOIN public.projetos_obras ob ON ob.id = pm.obra_id
    LEFT JOIN public.companies ce ON ce.id = pm.company_id
    CROSS JOIN LATERAL public.fn__permuta_calc(pm.id) c
    WHERE pm.company_id = ANY (v_allowed) AND pm.deleted_at IS NULL
  )
  SELECT jsonb_build_object('ok', true,
    'kpis', jsonb_build_object(
      'permuta_a_receber', COALESCE(round(sum(valor_atualizado),2),0),
      'produzido_quitado', COALESCE(round(sum(quitado),2),0),
      'saldo',             COALESCE(round(sum(saldo),2),0),
      'reajuste_acum',     COALESCE(round(sum(reajuste_acum),2),0),
      'quitadas',          count(*) FILTER (WHERE status_calc = 'quitado'),
      'em_aberto',         count(*) FILTER (WHERE status_calc IN ('a_iniciar','em_andamento','pagou_a_mais'))),
    'permutas', COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'company_id', company_id, 'empresa', emp_nome, 'obra_id', obra_id, 'obra', obra_nome,
      'contratante', contratante, 'ativo_descr', ativo_descr, 'tipo_contrato', tipo_contrato,
      'indice_reajuste', indice_reajuste, 'data_base', data_base, 'intragrupo', intragrupo,
      'valor_permuta', round(valor_permuta,2), 'valor_dinheiro', round(valor_dinheiro,2),
      'reajuste_acum', round(reajuste_acum,2), 'valor_atualizado', round(valor_atualizado,2),
      'quitado', round(quitado,2), 'saldo', round(saldo,2),
      'pct', CASE WHEN valor_atualizado > 0 THEN least(100, round(100*quitado/valor_atualizado,1)) ELSE 0 END,
      'status', status_calc) ORDER BY emp_nome, ativo_descr), '[]'::jsonb)
  ) INTO v_out FROM base;
  RETURN v_out;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_permuta_listar(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_listar(uuid[]) TO authenticated, service_role;

-- ── fn_permuta_salvar — cadastro/edição (CRIOU/ALTEROU). Guarda real de empresa. ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_permuta_salvar(
  p_id uuid, p_company_id uuid, p_obra_id uuid, p_contratante text, p_ativo_descr text, p_tipo_contrato text,
  p_pct_permuta numeric, p_valor_permuta numeric, p_valor_dinheiro numeric, p_indice_reajuste text,
  p_data_base date, p_contrato_anexo text, p_status text DEFAULT NULL, p_intragrupo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF COALESCE(btrim(p_ativo_descr),'') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'ativo_obrigatorio'); END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.hub_permuta (company_id, obra_id, contratante, ativo_descr, tipo_contrato, pct_permuta,
      valor_permuta, valor_dinheiro, indice_reajuste, data_base, status, intragrupo, contrato_anexo, criado_por)
    VALUES (p_company_id, p_obra_id, NULLIF(btrim(p_contratante),''), btrim(p_ativo_descr),
      COALESCE(p_tipo_contrato,'misto'), p_pct_permuta, COALESCE(p_valor_permuta,0), COALESCE(p_valor_dinheiro,0),
      NULLIF(btrim(p_indice_reajuste),''), p_data_base, COALESCE(p_status,'a_iniciar'), COALESCE(p_intragrupo,false),
      NULLIF(btrim(p_contrato_anexo),''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    PERFORM 1 FROM public.hub_permuta WHERE id = p_id AND company_id = p_company_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'permuta_nao_encontrada'); END IF;
    UPDATE public.hub_permuta SET
      obra_id = p_obra_id, contratante = NULLIF(btrim(p_contratante),''), ativo_descr = btrim(p_ativo_descr),
      tipo_contrato = COALESCE(p_tipo_contrato, tipo_contrato), pct_permuta = p_pct_permuta,
      valor_permuta = COALESCE(p_valor_permuta,0), valor_dinheiro = COALESCE(p_valor_dinheiro,0),
      indice_reajuste = NULLIF(btrim(p_indice_reajuste),''), data_base = p_data_base,
      status = COALESCE(p_status, status), intragrupo = COALESCE(p_intragrupo, intragrupo),
      contrato_anexo = NULLIF(btrim(p_contrato_anexo),''), atualizado_em = now()
    WHERE id = p_id AND company_id = p_company_id;
    v_id := p_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_permuta_salvar(uuid, uuid, uuid, text, text, text, numeric, numeric, numeric, text, date, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_salvar(uuid, uuid, uuid, text, text, text, numeric, numeric, numeric, text, date, text, text, boolean) TO authenticated, service_role;

-- ── fn_permuta_movimento_add — lança movimento manual nos 4 tipos ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_permuta_movimento_add(
  p_permuta_id uuid, p_tipo text, p_competencia date, p_valor numeric, p_data date, p_num_nota text,
  p_cnpj_emissor text, p_empresa_emissora_id uuid DEFAULT NULL, p_ref_tipo text DEFAULT NULL,
  p_ref_id uuid DEFAULT NULL, p_obs text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.hub_permuta WHERE id = p_permuta_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'permuta_nao_encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF p_tipo NOT IN ('material','servico','dinheiro','imovel') THEN RETURN jsonb_build_object('ok', false, 'erro', 'tipo_invalido'); END IF;
  INSERT INTO public.hub_permuta_movimento (permuta_id, company_id, tipo, competencia, valor, data, num_nota,
    cnpj_emissor, empresa_emissora_id, ref_tipo, ref_id, obs, criado_por)
  VALUES (p_permuta_id, v_company, p_tipo, p_competencia, COALESCE(p_valor,0), COALESCE(p_data, current_date),
    NULLIF(btrim(p_num_nota),''), NULLIF(btrim(p_cnpj_emissor),''), p_empresa_emissora_id, p_ref_tipo, p_ref_id,
    NULLIF(btrim(p_obs),''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_permuta_movimento_add(uuid, text, date, numeric, date, text, text, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_movimento_add(uuid, text, date, numeric, date, text, text, uuid, text, uuid, text) TO authenticated, service_role;

-- ── fn_permuta_excluir — soft-delete (RD-98), com motivo ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_permuta_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.hub_permuta WHERE id = p_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'permuta_nao_encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.hub_permuta SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = NULLIF(btrim(p_motivo),'')
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_permuta_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_excluir(uuid, text) TO authenticated, service_role;

-- ── fn_permuta_extrato(permuta_id) — extrato: contrato + reajuste = atualizado; movimentos por mês; quitado; saldo ─
CREATE OR REPLACE FUNCTION public.fn_permuta_extrato(p_permuta_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_out jsonb; c RECORD;
BEGIN
  SELECT company_id INTO v_company FROM public.hub_permuta WHERE id = p_permuta_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'permuta_nao_encontrada'); END IF;
  IF NOT (public.is_admin() OR v_company IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_empresa'); END IF;
  SELECT * INTO c FROM public.fn__permuta_calc(p_permuta_id);
  SELECT jsonb_build_object('ok', true,
    'cabecalho', (SELECT jsonb_build_object('id', pm.id, 'ativo_descr', pm.ativo_descr, 'contratante', pm.contratante,
        'obra_id', pm.obra_id, 'obra', coalesce(ob.nome,''), 'tipo_contrato', pm.tipo_contrato,
        'indice_reajuste', pm.indice_reajuste, 'data_base', pm.data_base,
        'valor_permuta', round(c.valor_permuta,2), 'reajuste_acum', round(c.reajuste_acum,2),
        'valor_atualizado', round(c.valor_atualizado,2), 'quitado', round(c.quitado,2), 'saldo', round(c.saldo,2),
        'status', c.status_calc)
      FROM public.hub_permuta pm LEFT JOIN public.projetos_obras ob ON ob.id = pm.obra_id WHERE pm.id = p_permuta_id),
    'reajustes', COALESCE((SELECT jsonb_agg(jsonb_build_object('competencia', competencia, 'indice_valor', indice_valor, 'valor_reajuste', round(valor_reajuste,2)) ORDER BY competencia)
        FROM public.hub_permuta_reajuste WHERE permuta_id = p_permuta_id), '[]'::jsonb),
    'meses', COALESCE((SELECT jsonb_agg(m ORDER BY (m->>'competencia')) FROM (
        SELECT jsonb_build_object('competencia', competencia, 'total', round(sum(valor),2),
                 'movimentos', jsonb_agg(jsonb_build_object('id', id, 'data', data, 'tipo', tipo, 'num_nota', num_nota,
                   'cnpj_emissor', cnpj_emissor, 'valor', round(valor,2), 'obs', obs) ORDER BY data, criado_em)) m
        FROM public.hub_permuta_movimento WHERE permuta_id = p_permuta_id AND deleted_at IS NULL
        GROUP BY competencia) z), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_permuta_extrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_extrato(uuid) TO authenticated, service_role;

-- ── fn_permuta_reajuste_add — lança o CUB do mês (manual no F1; a FATIA 2 automatiza o recálculo) ──────────────
CREATE OR REPLACE FUNCTION public.fn_permuta_reajuste_add(
  p_permuta_id uuid, p_competencia date, p_indice_valor numeric, p_valor_reajuste numeric)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.hub_permuta WHERE id = p_permuta_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'permuta_nao_encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  INSERT INTO public.hub_permuta_reajuste (permuta_id, company_id, competencia, indice_valor, valor_reajuste)
  VALUES (p_permuta_id, v_company, date_trunc('month', p_competencia)::date, p_indice_valor, COALESCE(p_valor_reajuste,0))
  ON CONFLICT (permuta_id, competencia) DO UPDATE SET indice_valor = EXCLUDED.indice_valor, valor_reajuste = EXCLUDED.valor_reajuste;
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_permuta_reajuste_add(uuid, date, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_reajuste_add(uuid, date, numeric, numeric) TO authenticated, service_role;

-- ── fn_permuta_consolidado_grupo(company_ids[]) — soma os CNPJs, elimina permuta intragrupo (linha visível) ────
CREATE OR REPLACE FUNCTION public.fn_permuta_consolidado_grupo(p_company_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_allowed uuid[]; v_out jsonb;
BEGIN
  SELECT array_agg(c) INTO v_allowed FROM unnest(COALESCE(p_company_ids,'{}')) c
   WHERE public.is_admin() OR c IN (SELECT public.get_user_company_ids());
  IF v_allowed IS NULL OR cardinality(v_allowed) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso_empresa'); END IF;
  WITH base AS (
    SELECT pm.intragrupo, c.valor_atualizado, c.quitado, c.saldo, c.reajuste_acum, c.status_calc
    FROM public.hub_permuta pm CROSS JOIN LATERAL public.fn__permuta_calc(pm.id) c
    WHERE pm.company_id = ANY (v_allowed) AND pm.deleted_at IS NULL
  )
  SELECT jsonb_build_object('ok', true,
    'consolidado', jsonb_build_object(
      'permuta_a_receber', COALESCE(round(sum(valor_atualizado) FILTER (WHERE NOT intragrupo),2),0),
      'produzido_quitado', COALESCE(round(sum(quitado) FILTER (WHERE NOT intragrupo),2),0),
      'saldo',             COALESCE(round(sum(saldo) FILTER (WHERE NOT intragrupo),2),0),
      'reajuste_acum',     COALESCE(round(sum(reajuste_acum) FILTER (WHERE NOT intragrupo),2),0),
      'quitadas',          count(*) FILTER (WHERE NOT intragrupo AND status_calc = 'quitado'),
      'em_aberto',         count(*) FILTER (WHERE NOT intragrupo AND status_calc IN ('a_iniciar','em_andamento','pagou_a_mais'))),
    'intragrupo_eliminado', jsonb_build_object(
      'permutas', count(*) FILTER (WHERE intragrupo),
      'valor_atualizado', COALESCE(round(sum(valor_atualizado) FILTER (WHERE intragrupo),2),0))
  ) INTO v_out FROM base;
  RETURN v_out;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_permuta_consolidado_grupo(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_permuta_consolidado_grupo(uuid[]) TO authenticated, service_role;
