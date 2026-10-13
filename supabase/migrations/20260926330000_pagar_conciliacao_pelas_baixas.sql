-- Contas a PAGAR com o mesmo defeito do #38 (decisão do CEO 26/09, ctx 9c68aae6: corrigir em PR separada).
--
-- Bug PROVADO em rollback (26/09, demo Comércio GE, caminhos oficiais, como o robô): título R$ 1.000;
-- pagamento parcial de R$ 250 (fn_pagar_baixar_pagamento); o extrato traz o débito de R$ 750; concilia
-- (fn_conciliacao_vincular) → valor_pago 750, PARCIAL (deveria ser 1.000, pago): os R$ 250 somem. E ao
-- desconciliar → valor_pago 0: some também o pagamento manual.
-- Causa: fn_recompute_baixa_titulo (ramo erp_pagar) grava valor_pago = SOMA DOS DÉBITOS CONCILIADOS;
-- fn_conciliacao_fechar_agrupado grava valor_pago = valor vinculado; fn_conciliacao_desvincular_movimento
-- subtrai o vinculado. Pagar não tem entidade de baixa (receber ganhou no #1722/#1723/#1833).
--
-- Correção = o mesmo modelo do receber:
--  1) erp_pagar_baixa (N baixas por título; RLS por empresa; anon nunca).
--  2) valor_pago DERIVADO da soma das baixas (fn_pagar_baixa_recompute; sem baixa → sem data de pagamento
--     e pago/parcial volta a aberto/vencido pelo trigger de status existente).
--  3) Guarda: qualquer escrita de valor_pago (tela, lote, CNAB, edição…) vira baixa pelo DELTA contra a soma
--     das baixas (idempotente; o próprio recompute termina com delta 0).
--  4) fn_pagar_conciliacao_sync: cada débito conciliado tem a sua baixa; reaproveita a baixa manual do mesmo
--     valor (confirma, não cria); nunca sobrepaga; desconciliar exclui só a baixa criada pela conciliação e
--     apenas SOLTA o vínculo da manual.
--  5) recompute / fechar_agrupado / desvincular_movimento passam pelo sync (pagar); aplicar_match e
--     sugerir_match pontuam pelo valor de referência (cheio, saldo ou baixa sem vínculo) e listam PARCIAIS.
--
-- SEM BACKFILL EM MASSA (RD-55): nenhum título existente é tocado por esta migration. O histórico de um
-- título (valor_pago sem baixa) só é materializado como baixa quando AQUELE título passa pela conciliação
-- (fn_pagar_conciliacao_sync) ou tem o valor_pago escrito (guarda) — o mesmo valor, nada muda de valor.
-- Sem isso, conciliar um título antigo com pagamento parcial perderia o valor (o defeito que se corrige).
--
-- RD-52 (arquivo = ledger) · RD-38 (provado no dado) · RD-82 (aceitação chama as RPCs como usuário).

-- 1) Entidade de baixa
CREATE TABLE IF NOT EXISTS public.erp_pagar_baixa (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagar_id           uuid NOT NULL REFERENCES public.erp_pagar(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL,
  valor              numeric NOT NULL CHECK (valor <> 0),
  data               date NOT NULL,
  forma              text,
  origem             text NOT NULL DEFAULT 'manual',
  movimento_banco_id uuid,
  observacao         text,
  criado_por         uuid DEFAULT auth.uid(),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid
);
CREATE INDEX IF NOT EXISTS idx_erp_pagar_baixa_pagar   ON public.erp_pagar_baixa(pagar_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_erp_pagar_baixa_company ON public.erp_pagar_baixa(company_id);
CREATE INDEX IF NOT EXISTS idx_erp_pagar_baixa_mov     ON public.erp_pagar_baixa(movimento_banco_id) WHERE movimento_banco_id IS NOT NULL;
COMMENT ON TABLE public.erp_pagar_baixa IS 'Baixas (pagamentos) de um título de erp_pagar. N por título. valor_pago do título = soma das baixas ativas (fn_pagar_baixa_recompute).';

ALTER TABLE public.erp_pagar_baixa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_pagar_baixa_select ON public.erp_pagar_baixa;
CREATE POLICY erp_pagar_baixa_select ON public.erp_pagar_baixa
  FOR SELECT TO authenticated
  USING (((company_id IN (SELECT get_user_company_ids())) OR is_admin()) AND deleted_at IS NULL);
DROP POLICY IF EXISTS erp_pagar_baixa_modify ON public.erp_pagar_baixa;
CREATE POLICY erp_pagar_baixa_modify ON public.erp_pagar_baixa
  FOR ALL TO authenticated
  USING ((company_id IN (SELECT get_user_company_ids())) OR is_admin())
  WITH CHECK ((company_id IN (SELECT get_user_company_ids())) OR is_admin());
REVOKE ALL ON TABLE public.erp_pagar_baixa FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.erp_pagar_baixa TO authenticated;
GRANT ALL ON TABLE public.erp_pagar_baixa TO service_role;

-- 2) Soma das baixas → valor_pago (sem baixa ativa: sem data de pagamento; pago/parcial reabre)
CREATE OR REPLACE FUNCTION public.fn_pagar_baixa_recompute()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_pid  uuid;
  v_soma numeric;
BEGIN
  v_pid := COALESCE(NEW.pagar_id, OLD.pagar_id);
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_pagar_baixa b
    WHERE b.pagar_id = v_pid AND b.deleted_at IS NULL;
  UPDATE public.erp_pagar
     SET valor_pago = v_soma,
         data_pagamento = CASE WHEN v_soma <= 0 THEN NULL ELSE data_pagamento END,
         status = CASE WHEN v_soma <= 0 AND status IN ('pago','parcial') THEN 'aberto' ELSE status END,
         updated_at = now()
   WHERE id = v_pid AND COALESCE(valor_pago,0) IS DISTINCT FROM v_soma;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_pagar_baixa_recompute ON public.erp_pagar_baixa;
CREATE TRIGGER trg_pagar_baixa_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.erp_pagar_baixa
  FOR EACH ROW EXECUTE FUNCTION public.fn_pagar_baixa_recompute();

-- 3) Guarda: toda escrita de valor_pago vira baixa pelo delta contra a soma das baixas ativas
CREATE OR REPLACE FUNCTION public.fn_pagar_valor_pago_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_soma  numeric;
  v_delta numeric;
BEGIN
  IF NEW.company_id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_pagar_baixa b
    WHERE b.pagar_id = NEW.id AND b.deleted_at IS NULL;
  v_delta := round(COALESCE(NEW.valor_pago,0) - v_soma, 2);
  IF v_delta <> 0 THEN
    INSERT INTO public.erp_pagar_baixa (pagar_id, company_id, valor, data, forma, origem, criado_por, criado_em)
    VALUES (NEW.id, NEW.company_id, v_delta, COALESCE(NEW.data_pagamento, CURRENT_DATE), NEW.forma_pagamento,
            'trigger_guarda', auth.uid(), now());
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS trg_pagar_valor_pago_guard ON public.erp_pagar;
CREATE TRIGGER trg_pagar_valor_pago_guard
  AFTER INSERT OR UPDATE OF valor_pago ON public.erp_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_pagar_valor_pago_guard();

-- 4a) Valor de referência de um título de pagar para um débito: o mais próximo entre o valor cheio,
--     o saldo aberto (quando já há pagamento) e as baixas ainda sem débito vinculado.
CREATE OR REPLACE FUNCTION public.fn_pagar_valor_referencia(p_pagar_id uuid, p_valor_debito numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT x.v FROM (
    SELECT p.valor AS v FROM public.erp_pagar p WHERE p.id = p_pagar_id
    UNION ALL
    SELECT round(p.valor + COALESCE(p.juros,0) + COALESCE(p.multa,0) - COALESCE(p.desconto,0) - COALESCE(p.valor_pago,0), 2)
      FROM public.erp_pagar p WHERE p.id = p_pagar_id AND COALESCE(p.valor_pago,0) > 0
    UNION ALL
    SELECT b.valor FROM public.erp_pagar_baixa b
     WHERE b.pagar_id = p_pagar_id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NULL
  ) x
  WHERE x.v > 0
  ORDER BY abs(x.v - abs(p_valor_debito))
  LIMIT 1
$function$;

-- 4b) Sincroniza as baixas de um título de pagar com a conciliação
CREATE OR REPLACE FUNCTION public.fn_pagar_conciliacao_sync(p_pagar_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; d record; x record;
  v_b uuid; v_liq numeric; v_soma numeric; v_n int; v_ativas numeric; v_falta numeric;
BEGIN
  SELECT id, company_id, valor, COALESCE(juros,0) AS j, COALESCE(multa,0) AS mu, COALESCE(desconto,0) AS de,
         forma_pagamento, COALESCE(valor_pago,0) AS pago, data_pagamento, data_emissao, origem_baixa, movimento_banco_id
    INTO r FROM public.erp_pagar WHERE id = p_pagar_id;
  IF r.id IS NULL THEN RETURN; END IF;
  v_liq := round(r.valor + r.j + r.mu - r.de, 2);

  -- histórico do título (valor_pago anterior à entidade de baixa) vira baixa com o MESMO valor — sem isso
  -- a primeira baixa da conciliação zeraria o pagamento já registrado (o defeito que se corrige)
  IF r.pago <> 0 AND NOT EXISTS (SELECT 1 FROM public.erp_pagar_baixa b WHERE b.pagar_id = p_pagar_id AND b.deleted_at IS NULL) THEN
    INSERT INTO public.erp_pagar_baixa (pagar_id, company_id, valor, data, forma, origem, movimento_banco_id, observacao, criado_por)
    VALUES (p_pagar_id, r.company_id, r.pago, COALESCE(r.data_pagamento, r.data_emissao, CURRENT_DATE), r.forma_pagamento,
            COALESCE(NULLIF(r.origem_baixa,''), 'manual'), r.movimento_banco_id, 'histórico do título (antes das baixas)', auth.uid());
  END IF;

  -- débitos conciliados deste título: vínculos (1:1 e agrupado) + 1:1 sem vínculo (defensivo)
  CREATE TEMP TABLE IF NOT EXISTS _conc_desejado_pagar (mov uuid, valor numeric, data date) ON COMMIT DROP;
  DELETE FROM _conc_desejado_pagar WHERE true;   -- pg-safeupdate (PostgREST) recusa DELETE sem WHERE
  INSERT INTO _conc_desejado_pagar (mov, valor, data)
  SELECT v.movimento_id, round(v.valor_vinculado, 2), m.data_transacao
    FROM public.conciliacao_vinculo v JOIN public.conciliacao_movimento m ON m.id = v.movimento_id
   WHERE v.lancamento_tabela = 'erp_pagar' AND v.lancamento_id = p_pagar_id AND m.status = 'conciliado'
  UNION ALL
  SELECT m.id, round(abs(m.valor), 2), m.data_transacao
    FROM public.conciliacao_movimento m
   WHERE m.lancamento_tabela = 'erp_pagar' AND m.lancamento_id = p_pagar_id AND m.status = 'conciliado'
     AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v
                      WHERE v.movimento_id = m.id AND v.lancamento_tabela = 'erp_pagar' AND v.lancamento_id = p_pagar_id);

  SELECT COALESCE(sum(valor), 0), count(*) INTO v_soma, v_n FROM _conc_desejado_pagar;
  IF v_n >= 2 AND v_soma > v_liq + 0.01 THEN
    RAISE EXCEPTION 'Conciliação excede o valor do título: % movimentos somam % para um líquido de %. Desvincule um antes.',
      v_n, to_char(v_soma,'FM999999990.00'), to_char(v_liq,'FM999999990.00') USING ERRCODE = '23514';
  END IF;

  -- a) baixas ligadas a débitos que NÃO estão mais conciliados neste título
  FOR x IN
    SELECT b.id, b.origem FROM public.erp_pagar_baixa b
     WHERE b.pagar_id = p_pagar_id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM _conc_desejado_pagar dd WHERE dd.mov = b.movimento_banco_id)
  LOOP
    IF x.origem = 'conciliacao' THEN
      UPDATE public.erp_pagar_baixa SET deleted_at = now(), deleted_by = auth.uid() WHERE id = x.id;
    ELSE
      UPDATE public.erp_pagar_baixa SET movimento_banco_id = NULL WHERE id = x.id;   -- manual: só solta o vínculo
    END IF;
  END LOOP;

  -- b) cada débito conciliado tem a sua baixa (reaproveitando a manual quando for o mesmo dinheiro)
  FOR d IN SELECT * FROM _conc_desejado_pagar ORDER BY data, mov LOOP
    SELECT id INTO v_b FROM public.erp_pagar_baixa
     WHERE pagar_id = p_pagar_id AND deleted_at IS NULL AND movimento_banco_id = d.mov
     ORDER BY criado_em LIMIT 1;
    IF v_b IS NOT NULL THEN
      UPDATE public.erp_pagar_baixa SET valor = d.valor WHERE id = v_b AND round(valor, 2) <> d.valor;
      CONTINUE;
    END IF;

    SELECT id INTO v_b FROM public.erp_pagar_baixa
     WHERE pagar_id = p_pagar_id AND deleted_at IS NULL AND movimento_banco_id IS NULL AND abs(valor - d.valor) < 0.01
     ORDER BY data, criado_em LIMIT 1;
    IF v_b IS NOT NULL THEN
      UPDATE public.erp_pagar_baixa SET movimento_banco_id = d.mov WHERE id = v_b;   -- confirma o pagamento já registrado
      CONTINUE;
    END IF;

    SELECT COALESCE(sum(valor), 0) INTO v_ativas FROM public.erp_pagar_baixa
     WHERE pagar_id = p_pagar_id AND deleted_at IS NULL;
    IF v_ativas + d.valor > v_liq + 0.01 THEN
      -- criar baixa sobrepagaria: o dinheiro já está registrado em baixas sem vínculo → liga-as (sem criar valor)
      v_falta := d.valor;
      FOR x IN SELECT id, valor FROM public.erp_pagar_baixa
                WHERE pagar_id = p_pagar_id AND deleted_at IS NULL AND movimento_banco_id IS NULL AND valor > 0
                ORDER BY data, criado_em LOOP
        EXIT WHEN v_falta <= 0.01;
        UPDATE public.erp_pagar_baixa SET movimento_banco_id = d.mov WHERE id = x.id;
        v_falta := v_falta - x.valor;
      END LOOP;
      CONTINUE;
    END IF;

    INSERT INTO public.erp_pagar_baixa (pagar_id, company_id, valor, data, forma, origem, movimento_banco_id, criado_por)
    VALUES (p_pagar_id, r.company_id, d.valor, d.data, 'conciliacao_bancaria', 'conciliacao', d.mov, auth.uid());
  END LOOP;

  -- c) data/forma de pagamento acompanham as baixas (sem baixa → sem data)
  UPDATE public.erp_pagar t
     SET data_pagamento = CASE WHEN COALESCE(t.valor_pago, 0) > 0
                               THEN (SELECT max(b.data) FROM public.erp_pagar_baixa b WHERE b.pagar_id = t.id AND b.deleted_at IS NULL)
                               ELSE NULL END,
         forma_pagamento = CASE WHEN COALESCE(t.valor_pago, 0) > 0
                                THEN COALESCE(NULLIF(t.forma_pagamento, ''), CASE WHEN v_n > 0 THEN 'conciliacao_bancaria' END)
                                ELSE t.forma_pagamento END,
         updated_at = now()
   WHERE t.id = p_pagar_id
     AND ( t.data_pagamento IS DISTINCT FROM CASE WHEN COALESCE(t.valor_pago, 0) > 0
                               THEN (SELECT max(b.data) FROM public.erp_pagar_baixa b WHERE b.pagar_id = t.id AND b.deleted_at IS NULL)
                               ELSE NULL END
        OR (COALESCE(t.valor_pago, 0) > 0 AND NULLIF(t.forma_pagamento, '') IS NULL AND v_n > 0) );
END $function$;
REVOKE ALL ON FUNCTION public.fn_pagar_conciliacao_sync(uuid) FROM PUBLIC, anon, authenticated;

-- 5) Recompute chamado pela trigger da conciliação: PAGAR também passa pela sincronização das baixas.
CREATE OR REPLACE FUNCTION public.fn_recompute_baixa_titulo(p_tabela text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
        v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF p_id IS NULL OR p_tabela NOT IN ('erp_receber','erp_pagar') THEN RETURN; END IF;
  IF p_tabela = 'erp_receber' THEN SELECT company_id INTO v_company FROM public.erp_receber WHERE id = p_id;
  ELSE SELECT company_id INTO v_company FROM public.erp_pagar WHERE id = p_id; END IF;
  IF v_company IS NULL THEN RETURN; END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  -- baixas são a fonte; a conciliação nunca sobrescreve o pagamento já registrado (#38 receber · pagar)
  IF p_tabela = 'erp_receber' THEN
    PERFORM public.fn_receber_conciliacao_sync(p_id);
  ELSE
    PERFORM public.fn_pagar_conciliacao_sync(p_id);
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fn_recompute_baixa_titulo(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_recompute_baixa_titulo(text, uuid) TO authenticated, service_role;

-- 6) Conciliação AGRUPADA (um débito → vários títulos, ex.: fatura de cartão): pagar pelas baixas.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_fechar_agrupado(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid, p_tolerancia numeric DEFAULT 0.05, p_juros numeric DEFAULT 0, p_multa numeric DEFAULT 0, p_desconto numeric DEFAULT 0, p_ajuste_lancamento_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mov record; v_soma numeric; v_vin record; v_qtd int := 0;
  v_acr numeric := round(coalesce(p_juros,0) + coalesce(p_multa,0), 2);
  v_desc numeric := round(coalesce(p_desconto,0), 2);
  v_efetivo numeric; v_anchor uuid; v_anchor_tab text;
  v_receber uuid[] := '{}';
  v_pagar uuid[] := '{}';
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
begin
  select * into v_mov from conciliacao_movimento where id = p_movimento_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'movimento nao encontrado'); end if;
  if not (v_interno or auth.role()='service_role' or v_mov.company_id in (select get_user_company_ids()) or is_admin()) then
    raise exception 'Sem acesso a esta empresa' using errcode='42501';
  end if;
  if v_mov.status = 'conciliado' then
    return jsonb_build_object('ok', true, 'conciliado', true, 'ja', true, 'valor', v_mov.valor);
  end if;
  select coalesce(sum(valor_vinculado),0) into v_soma from conciliacao_vinculo where movimento_id = p_movimento_id;
  if v_soma = 0 then return jsonb_build_object('ok', false, 'erro', 'nenhuma conta vinculada'); end if;

  v_efetivo := round(v_soma + v_acr - v_desc, 2);
  if abs(abs(v_mov.valor) - v_efetivo) > p_tolerancia then
    return jsonb_build_object('ok', false, 'erro', 'soma nao fecha com a fatura',
      'valor_movimento', v_mov.valor, 'soma_vinculada', v_soma, 'acrescimo', v_acr, 'desconto', v_desc,
      'saldo', round(abs(v_mov.valor) - v_efetivo, 2));
  end if;

  if p_ajuste_lancamento_id is not null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id and lancamento_id = p_ajuste_lancamento_id limit 1;
  end if;
  if v_anchor is null then
    select lancamento_id, lancamento_tabela into v_anchor, v_anchor_tab
      from conciliacao_vinculo where movimento_id = p_movimento_id order by valor_vinculado desc limit 1;
  end if;

  if (v_acr <> 0 or v_desc <> 0) and v_anchor is not null then
    perform fn_conciliacao_ajustar_valores(
      v_anchor, case when v_anchor_tab = 'erp_pagar' then 'pagar' else 'receber' end,
      v_acr, v_desc, coalesce(nullif(btrim(p_observacao),''), 'conciliação: diferença banco × título'), null);
    -- o acréscimo/desconto entra no valor vinculado do título-âncora (a baixa daquele movimento passa a ter
    -- o valor efetivamente pago/recebido; a soma dos vínculos fecha com o extrato) — receber e pagar
    update conciliacao_vinculo set valor_vinculado = round(valor_vinculado + v_acr - v_desc, 2)
     where movimento_id = p_movimento_id and lancamento_tabela = v_anchor_tab and lancamento_id = v_anchor;
  end if;

  for v_vin in select * from conciliacao_vinculo where movimento_id = p_movimento_id loop
    if v_vin.lancamento_tabela = 'erp_pagar' then
      -- pagar não grava mais valor_pago aqui; a baixa nasce (ou é reaproveitada) no sync abaixo
      update erp_pagar set conciliado = true, movimento_banco_id = p_movimento_id,
             forma_pagamento = coalesce(nullif(forma_pagamento,''), 'cartao_credito'), updated_at = now()
        where id = v_vin.lancamento_id;
      v_pagar := array_append(v_pagar, v_vin.lancamento_id);
    else
      update erp_receber set conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
        where id = v_vin.lancamento_id;
      v_receber := array_append(v_receber, v_vin.lancamento_id);
    end if;
    v_qtd := v_qtd + 1;
  end loop;

  update conciliacao_movimento set status='conciliado', match_origem='agrupado',
    match_aplicado_em=now(), match_aplicado_por=COALESCE(auth.uid(), p_operador_id) where id = p_movimento_id;

  perform public.fn_receber_conciliacao_sync(x) from unnest(v_receber) x;
  perform public.fn_pagar_conciliacao_sync(x) from unnest(v_pagar) x;

  return jsonb_build_object('ok', true, 'conciliado', true, 'qtd_baixados', v_qtd,
    'valor', v_mov.valor, 'acrescimo', v_acr, 'desconto', v_desc, 'ajuste_lancamento', v_anchor);
end;
$function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_fechar_agrupado(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text) TO authenticated, service_role;

-- 7) Desvincular débito AGRUPADO: pagar pelas baixas (a manual volta a ficar "paga aguardando conciliação").
CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular_movimento(p_movimento_id uuid, p_operador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mov        RECORD;
  v_vin        RECORD;
  v_reabertos  int := 0;
  v_com_ajuste int := 0;
  v_ajuste_ids jsonb := '[]'::jsonb;
  v_receber    uuid[] := '{}';
  v_pagar      uuid[] := '{}';
BEGIN
  SELECT * INTO v_mov FROM public.conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'movimento_nao_encontrado');
  END IF;

  IF NOT (v_mov.company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_vinculos',
      'msg', 'Movimento sem vínculos agrupados. Para vínculo 1:1 use a desvinculação normal.');
  END IF;

  IF v_mov.status = 'conciliado' THEN
    FOR v_vin IN
      SELECT cv.lancamento_tabela, cv.lancamento_id, cv.valor_vinculado,
             ( EXISTS (SELECT 1 FROM public.erp_pagar   p WHERE p.id = cv.lancamento_id
                        AND (COALESCE(p.juros,0) <> 0 OR COALESCE(p.desconto,0) <> 0
                             OR p.observacoes ILIKE '%AJUSTE%' OR p.observacoes ILIKE '%VALOR AJUSTADO%'))
               OR EXISTS (SELECT 1 FROM public.erp_receber r WHERE r.id = cv.lancamento_id
                        AND (COALESCE(r.juros,0) <> 0 OR COALESCE(r.desconto,0) <> 0
                             OR r.observacoes ILIKE '%AJUSTE%' OR r.observacoes ILIKE '%VALOR AJUSTADO%')) ) AS had_ajuste
      FROM public.conciliacao_vinculo cv
      WHERE cv.movimento_id = p_movimento_id
    LOOP
      -- não subtrai valor_pago; o sync (após limpar os vínculos) desfaz só o que a conciliação fez
      IF v_vin.lancamento_tabela = 'erp_pagar' THEN
        UPDATE public.erp_pagar SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
         WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        v_pagar := array_append(v_pagar, v_vin.lancamento_id);
      ELSE
        UPDATE public.erp_receber SET conciliado = false, movimento_banco_id = NULL, updated_at = now()
         WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        v_receber := array_append(v_receber, v_vin.lancamento_id);
      END IF;

      v_reabertos := v_reabertos + 1;
      IF v_vin.had_ajuste THEN
        v_com_ajuste := v_com_ajuste + 1;
        v_ajuste_ids := v_ajuste_ids || to_jsonb(v_vin.lancamento_id);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.conciliacao_vinculo WHERE movimento_id = p_movimento_id;

  UPDATE public.conciliacao_movimento
     SET status = 'pendente', lancamento_tabela = NULL, lancamento_id = NULL,
         match_score = NULL, match_origem = NULL, match_aplicado_em = NULL, match_aplicado_por = NULL,
         updated_at = now()
   WHERE id = p_movimento_id;

  PERFORM public.fn_receber_conciliacao_sync(x) FROM unnest(v_receber) x;
  PERFORM public.fn_pagar_conciliacao_sync(x) FROM unnest(v_pagar) x;

  RETURN jsonb_build_object(
    'sucesso', true,
    'movimento_id', p_movimento_id,
    'titulos_reabertos', v_reabertos,
    'titulos_com_ajuste', v_com_ajuste,
    'titulos_com_ajuste_ids', v_ajuste_ids,
    'aviso', CASE WHEN v_com_ajuste > 0
      THEN format('%s título(s) tinham ajuste de juros/desconto na conciliação: a baixa foi estornada, mas confira valor/juros/desconto manualmente.', v_com_ajuste)
      ELSE NULL END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_desvincular_movimento(uuid, uuid) TO authenticated, service_role;

-- 8) Aplicar match: PAGAR pontua pelo valor de referência (cheio, saldo ou baixa sem vínculo), como o receber.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_aplicar_match(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid, p_origem text DEFAULT 'manual'::text, p_motivo text DEFAULT NULL::text)
 RETURNS TABLE(movimento_id uuid, status_resultado text, mensagem text)
 LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
DECLARE v_mov RECORD; v_score numeric; v_ja numeric; v_liq numeric;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento não encontrado'; RETURN; END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento já processado: ' || v_mov.status; RETURN;
  END IF;
  SELECT COALESCE(SUM(valor),0) INTO v_ja FROM public.conciliacao_movimento
    WHERE lancamento_tabela = p_lancamento_tabela AND lancamento_id = p_lancamento_id AND status = 'conciliado' AND id <> p_movimento_id;
  IF p_lancamento_tabela = 'erp_pagar' THEN
    SELECT round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2) INTO v_liq FROM public.erp_pagar WHERE id = p_lancamento_id;
  ELSIF p_lancamento_tabela = 'erp_receber' THEN
    SELECT round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2) INTO v_liq FROM public.erp_receber WHERE id = p_lancamento_id;
  END IF;
  IF v_liq IS NOT NULL AND round(v_ja + v_mov.valor, 2) > v_liq + 0.01 THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Este título já foi conciliado (valor já coberto). Não vou duplicar a baixa.'::text; RETURN;
  END IF;
  IF p_lancamento_tabela = 'erp_pagar' THEN
    -- o débito pode estar pagando o saldo ou confirmando uma baixa já registrada — não só o valor cheio
    SELECT CASE WHEN abs(COALESCE(public.fn_pagar_valor_referencia(p.id, v_mov.valor), p.valor) - abs(v_mov.valor)) < 0.01 THEN 50 ELSE 25 END
         + CASE WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30 ELSE 10 END + 20
      INTO v_score FROM erp_pagar p WHERE p.id = p_lancamento_id;
  ELSE
    SELECT CASE WHEN abs(COALESCE(public.fn_receber_valor_referencia(r.id, v_mov.valor), r.valor) - abs(v_mov.valor)) < 0.01 THEN 50 ELSE 25 END
         + CASE WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30 ELSE 10 END + 20
      INTO v_score FROM erp_receber r WHERE r.id = p_lancamento_id;
  END IF;
  IF COALESCE(v_score,0) < 70 AND COALESCE(btrim(p_motivo),'') = '' THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Match de baixa confiança (score '||COALESCE(v_score,0)::text||'). Informe o motivo para confirmar.'; RETURN;
  END IF;
  UPDATE conciliacao_movimento
     SET lancamento_tabela = p_lancamento_tabela, lancamento_id = p_lancamento_id,
         match_score = v_score, match_origem = p_origem, match_aplicado_em = now(),
         match_aplicado_por = p_operador_id, status = 'conciliado',
         obs = CASE WHEN COALESCE(btrim(p_motivo),'')<>'' THEN left('[match '||COALESCE(v_score,0)::text||'] '||p_motivo, 500) ELSE obs END,
         updated_at = now()
   WHERE id = p_movimento_id;

  INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por)
  VALUES (p_movimento_id, v_mov.company_id, p_lancamento_tabela, p_lancamento_id, round(abs(v_mov.valor),2), p_operador_id)
  ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO UPDATE SET valor_vinculado = EXCLUDED.valor_vinculado;

  IF p_lancamento_tabela = 'erp_pagar' THEN
    UPDATE erp_pagar SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
  ELSE
    UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now() WHERE id = p_lancamento_id;
  END IF;

  IF length(v_mov.descricao_normalizada) >= 5 THEN
    INSERT INTO conciliacao_regra (company_id, tipo_lote, padrao_descricao, padrao_tipo, sugestao_psgc, origem, hits_total, hits_aceitos, ultima_aplicacao)
    SELECT v_mov.company_id, cl.tipo, substring(v_mov.descricao_normalizada FROM 1 FOR LEAST(30, length(v_mov.descricao_normalizada))),
           'substring', v_mov.psgc_sugestao, 'aprendido', 1, 1, now()
    FROM conciliacao_lote cl WHERE cl.id = v_mov.lote_id
    ON CONFLICT (company_id, tipo_lote, padrao_descricao) DO UPDATE
      SET hits_total = conciliacao_regra.hits_total + 1, hits_aceitos = conciliacao_regra.hits_aceitos + 1, ultima_aplicacao = now(), updated_at = now();
  END IF;
  RETURN QUERY SELECT p_movimento_id, 'conciliado', 'Match aplicado com score ' || v_score::text;
END; $function$;

-- 9) Sugestão de match: PAGAR pontua pelo valor de referência e inclui títulos PARCIAIS (como o receber).
CREATE OR REPLACE FUNCTION public.fn_conciliacao_sugerir_match(p_movimento_id uuid, p_max_sugestoes integer DEFAULT 5)
 RETURNS TABLE(lancamento_tabela text, lancamento_id uuid, data_lancamento date, valor_lancamento numeric, descricao_lancamento text, contraparte text, status_lancamento text, match_score numeric, match_categoria text, motivo text)
 LANGUAGE plpgsql
AS $function$
DECLARE v_mov RECORD; v_doc text; v_mov_forma text;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_doc := regexp_replace(COALESCE((regexp_match(v_mov.descricao,'(\d{14}|\d{11})'))[1],''),'\D','','g');
  IF length(v_doc) NOT IN (11,14) THEN v_doc := NULL; END IF;

  v_mov_forma := CASE
    WHEN v_mov.descricao ~* 'pix' THEN 'pix'
    WHEN v_mov.descricao ~* 'boleto|cobran|liquidac|liquidaç|t[ií]tulo|\mtit\M' THEN 'boleto'
    WHEN v_mov.descricao ~* '\mted\M|\mdoc\M|transfer' THEN 'ted'
    ELSE NULL END;

  RETURN QUERY
  WITH candidatos AS (
    SELECT 'erp_pagar'::text tabela, p.id lanc_id, p.data_vencimento::date data_lanc,
      p.valor::numeric valor_lanc, pr.v::numeric valor_ref, COALESCE(p.descricao,p.fornecedor_nome,'')::text desc_lanc,
      p.fornecedor_nome::text contrap, p.status::text status_lanc,
      (v_mov_forma IS NOT NULL AND lower(COALESCE(p.forma_pagamento,'')) ~ v_mov_forma) AS forma_conf,
      false AS forma_inf,
      ( CASE WHEN abs(pr.v-v_mov.valor)<0.01 THEN 50 WHEN abs(pr.v-v_mov.valor)<=1 THEN 40
             WHEN abs(pr.v-v_mov.valor)<=10 THEN 25
             WHEN abs(pr.v-v_mov.valor)/NULLIF(v_mov.valor,0)<0.05 THEN 15 ELSE 0 END
      + CASE WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=1 THEN 30
             WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=3 THEN 20
             WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=7 THEN 10 ELSE 0 END
      + CASE WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')),v_mov.descricao_normalizada)>=0.7 THEN 20
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')),v_mov.descricao_normalizada)>=0.4 THEN 10
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(p.fornecedor_nome,'')||' '||COALESCE(p.descricao,'')),v_mov.descricao_normalizada)>=0.2 THEN 5 ELSE 0 END
      + CASE WHEN v_doc IS NOT NULL AND v_doc = regexp_replace(COALESCE(NULLIF(f.cnpj_cpf,''),f.cpf_cnpj,''),'\D','','g') THEN 45 ELSE 0 END
      + CASE WHEN (v_mov_forma IS NOT NULL AND lower(COALESCE(p.forma_pagamento,'')) ~ v_mov_forma) THEN 25 ELSE 0 END
      )::numeric score
    FROM (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) p LEFT JOIN erp_fornecedores f ON f.id = p.fornecedor_id
    CROSS JOIN LATERAL (SELECT COALESCE(public.fn_pagar_valor_referencia(p.id, v_mov.valor), p.valor) AS v) pr
    WHERE p.company_id=v_mov.company_id AND p.status IN ('aberto','vencido','parcial','pago')
      AND p.data_vencimento BETWEEN v_mov.data_transacao-INTERVAL '15 days' AND v_mov.data_transacao+INTERVAL '15 days'
      AND v_mov.natureza='debito'
      AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento cm2 WHERE cm2.lancamento_id=p.id AND cm2.lancamento_tabela='erp_pagar' AND cm2.status='conciliado')
    UNION ALL
    SELECT 'erp_receber'::text, r.id, r.data_vencimento::date, r.valor::numeric, vr.v::numeric,
      COALESCE(r.descricao,r.cliente_nome,'')::text, r.cliente_nome::text, r.status::text,
      ( (v_mov_forma='pix' AND lower(COALESCE(r.forma_pagamento,'')) ~ 'pix')
        OR (v_mov_forma='boleto' AND (r.boleto_nosso_numero IS NOT NULL OR lower(COALESCE(r.forma_pagamento,'')) ~ 'boleto'))
        OR (v_mov_forma='ted' AND lower(COALESCE(r.forma_pagamento,'')) ~ 'ted|transf|doc') ) AS forma_conf,
      ( v_mov_forma='pix' AND r.boleto_nosso_numero IS NULL AND COALESCE(NULLIF(trim(lower(r.forma_pagamento)),''),'')='' ) AS forma_inf,
      ( CASE WHEN abs(vr.v-v_mov.valor)<0.01 THEN 50 WHEN abs(vr.v-v_mov.valor)<=1 THEN 40
             WHEN abs(vr.v-v_mov.valor)<=10 THEN 25
             WHEN abs(vr.v-v_mov.valor)/NULLIF(v_mov.valor,0)<0.05 THEN 15 ELSE 0 END
      + CASE WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=1 THEN 30
             WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=3 THEN 20
             WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp-v_mov.data_transacao::timestamp)))<=7 THEN 10 ELSE 0 END
      + CASE WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')),v_mov.descricao_normalizada)>=0.7 THEN 20
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')),v_mov.descricao_normalizada)>=0.4 THEN 10
             WHEN similarity(fn_normalizar_texto_alerta(COALESCE(r.cliente_nome,'')||' '||COALESCE(r.descricao,'')),v_mov.descricao_normalizada)>=0.2 THEN 5 ELSE 0 END
      + CASE WHEN v_doc IS NOT NULL AND v_doc = regexp_replace(COALESCE(NULLIF(c.cnpj_cpf,''),c.cpf_cnpj,''),'\D','','g') THEN 45 ELSE 0 END
      + CASE
          WHEN ( (v_mov_forma='pix' AND lower(COALESCE(r.forma_pagamento,'')) ~ 'pix')
                 OR (v_mov_forma='boleto' AND (r.boleto_nosso_numero IS NOT NULL OR lower(COALESCE(r.forma_pagamento,'')) ~ 'boleto'))
                 OR (v_mov_forma='ted' AND lower(COALESCE(r.forma_pagamento,'')) ~ 'ted|transf|doc') ) THEN 25
          WHEN ( v_mov_forma='pix' AND r.boleto_nosso_numero IS NULL AND COALESCE(NULLIF(trim(lower(r.forma_pagamento)),''),'')='' ) THEN 15
          ELSE 0 END
      )::numeric
    FROM (SELECT * FROM public.erp_receber WHERE deleted_at IS NULL) r LEFT JOIN erp_clientes c ON c.id = r.cliente_id
    CROSS JOIN LATERAL (SELECT COALESCE(public.fn_receber_valor_referencia(r.id, v_mov.valor), r.valor) AS v) vr
    WHERE r.company_id=v_mov.company_id AND r.status IN ('aberto','vencido','parcial','pago')
      AND r.data_vencimento BETWEEN v_mov.data_transacao-INTERVAL '15 days' AND v_mov.data_transacao+INTERVAL '15 days'
      AND v_mov.natureza='credito'
      AND NOT EXISTS (SELECT 1 FROM conciliacao_movimento cm2 WHERE cm2.lancamento_id=r.id AND cm2.lancamento_tabela='erp_receber' AND cm2.status='conciliado')
  )
  SELECT c.tabela,c.lanc_id,c.data_lanc,c.valor_lanc,c.desc_lanc,c.contrap,c.status_lanc,c.score,
    (CASE WHEN c.score>=90 AND c.forma_conf THEN 'perfeito'
          WHEN c.score>=60 THEN 'quase'
          ELSE 'fraco' END)::text,
    ('valor_diff='||(c.valor_ref-v_mov.valor)::text||' dias_diff='||abs(EXTRACT(DAY FROM (c.data_lanc::timestamp-v_mov.data_transacao::timestamp)))::text
      ||CASE WHEN c.valor_ref <> c.valor_lanc THEN ' ref='||c.valor_ref::text||'(saldo/baixa)' ELSE '' END
      ||CASE WHEN v_doc IS NOT NULL THEN ' doc✓' ELSE '' END
      ||CASE WHEN c.forma_conf THEN ' forma✓('||COALESCE(v_mov_forma,'?')||')'
             WHEN c.forma_inf THEN ' forma~inferida(sem boleto)'
             ELSE '' END)::text
  FROM candidatos c WHERE c.score>30 ORDER BY c.score DESC LIMIT p_max_sugestoes;
END; $function$;
