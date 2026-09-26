-- Chamado #38 (KGF · Jordana) · Grupo 1 — conciliação de CONTAS A RECEBER passa a respeitar as baixas.
--
-- Bug PROVADO em rollback (26/09, demo Comércio GE, caminhos oficiais): título R$ 1.000; atendente marca
-- R$ 250 pago (fn_receber_baixar_pagamento); extrato traz o crédito de R$ 750; financeiro concilia →
-- valor_pago 750, status PARCIAL (deveria ser 1.000, pago). Os R$ 250 "somem" — o que a Jordana descreveu.
-- Causa: fn_recompute_baixa_titulo grava valor_pago = SOMA DOS CRÉDITOS CONCILIADOS e ignora as baixas
-- (erp_receber_baixa, fonte de verdade desde o #1722); o guarda (#1723) cria um ajuste para igualar.
-- O mesmo padrão existia em fn_conciliacao_fechar_agrupado (valor_pago = valor vinculado) e em
-- fn_conciliacao_desvincular_movimento (valor_pago − vinculado) — RD-71.
-- A etapa "conciliação lendo baixas", prevista em 23/09, não tinha sido feita.
--
-- Regra nova (só RECEBER; contas a pagar não têm entidade de baixa e seguem como estão):
--   fn_receber_conciliacao_sync(título) parte do que está DE FATO conciliado (vínculos de movimentos com
--   status conciliado + 1:1 sem vínculo) e, para cada crédito:
--     · já existe baixa ligada àquele movimento → mantém (ajusta o valor se mudou);
--     · existe baixa SEM movimento com o mesmo valor → LIGA o crédito a ela (não cria baixa);
--     · criar baixa sobrepagaria o título → liga baixas sem movimento existentes (confirma o que já foi
--       registrado, sem criar valor);
--     · senão → cria a baixa da conciliação (origem 'conciliacao', data do crédito).
--   Crédito que deixou de estar conciliado: baixa criada pela conciliação é excluída (soft); baixa manual
--   só perde o vínculo (valor preservado).
--   valor_pago continua derivado da soma das baixas (trigger do #1722); status pelo trigger existente.
-- NÃO há backfill: nenhum título existente é recalculado por esta migration (RD-55). Títulos antigos só
-- passam pela regra nova quando forem conciliados/desconciliados de novo.
-- Pontuação do match (fn_conciliacao_aplicar_match / fn_conciliacao_sugerir_match): o crédito é comparado
-- com o valor que ele pode estar pagando — valor cheio, saldo aberto ou uma baixa sem vínculo — e não só
-- com o valor cheio (era a origem do falso "baixo match" do #38). A sugestão passa a listar também
-- títulos PARCIAIS (antes só aberto/vencido/pago: o título com R$ 250 já marcado nem aparecia).
--
-- Achado no rollback (RD-71): excluir a ÚLTIMA baixa zerava valor_pago mas deixava data_pagamento e o
-- status 'pago'; fn_calcular_status_lancamento devolve 'pago' com data de pagamento OU status anterior
-- 'pago', e o trigger de status repunha valor_pago = líquido (o guarda criava uma baixa-fantasma do valor
-- cheio — o título nunca reabria). fn_receber_baixa_recompute agora, quando a soma das baixas ativas é
-- zero, limpa data_pagamento e devolve pago/parcial para 'aberto' (o trigger decide aberto × vencido).
-- Cancelado/renegociado/previsto não são tocados.

-- 0) Soma das baixas → valor_pago; sem baixa ativa, sem data de pagamento
CREATE OR REPLACE FUNCTION public.fn_receber_baixa_recompute()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rid  uuid;
  v_soma numeric;
BEGIN
  v_rid := COALESCE(NEW.receber_id, OLD.receber_id);
  SELECT COALESCE(SUM(b.valor), 0) INTO v_soma
    FROM public.erp_receber_baixa b
    WHERE b.receber_id = v_rid AND b.deleted_at IS NULL;
  UPDATE public.erp_receber
     SET valor_pago = v_soma,
         data_pagamento = CASE WHEN v_soma <= 0 THEN NULL ELSE data_pagamento END,
         -- sem baixa: 'pago'/'parcial' deixa de valer; o trigger de status recalcula aberto/vencido
         status = CASE WHEN v_soma <= 0 AND status IN ('pago','parcial') THEN 'aberto' ELSE status END,
         updated_at = now()
   WHERE id = v_rid AND COALESCE(valor_pago,0) IS DISTINCT FROM v_soma;
  RETURN NULL;
END;
$function$;

-- 0b) Valor de referência de um título de receber para um crédito: o mais próximo entre o valor cheio,
--     o saldo aberto (quando já há recebimento) e as baixas ainda sem crédito vinculado.
CREATE OR REPLACE FUNCTION public.fn_receber_valor_referencia(p_receber_id uuid, p_valor_credito numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT x.v FROM (
    SELECT r.valor AS v FROM public.erp_receber r WHERE r.id = p_receber_id
    UNION ALL
    SELECT round(r.valor + COALESCE(r.juros,0) + COALESCE(r.multa,0) - COALESCE(r.desconto,0) - COALESCE(r.valor_pago,0), 2)
      FROM public.erp_receber r WHERE r.id = p_receber_id AND COALESCE(r.valor_pago,0) > 0
    UNION ALL
    SELECT b.valor FROM public.erp_receber_baixa b
     WHERE b.receber_id = p_receber_id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NULL
  ) x
  WHERE x.v > 0
  ORDER BY abs(x.v - abs(p_valor_credito))
  LIMIT 1
$function$;

-- 1) Sincroniza as baixas de um título de receber com a conciliação
CREATE OR REPLACE FUNCTION public.fn_receber_conciliacao_sync(p_receber_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; d record; x record;
  v_b uuid; v_liq numeric; v_soma numeric; v_n int; v_ativas numeric; v_falta numeric;
BEGIN
  SELECT id, company_id, valor, COALESCE(juros,0) AS j, COALESCE(multa,0) AS mu, COALESCE(desconto,0) AS de, forma_pagamento
    INTO r FROM public.erp_receber WHERE id = p_receber_id;
  IF r.id IS NULL THEN RETURN; END IF;
  v_liq := round(r.valor + r.j + r.mu - r.de, 2);

  -- créditos conciliados deste título: vínculos (1:1 e agrupado) + 1:1 sem vínculo (defensivo)
  CREATE TEMP TABLE IF NOT EXISTS _conc_desejado (mov uuid, valor numeric, data date) ON COMMIT DROP;
  DELETE FROM _conc_desejado;
  INSERT INTO _conc_desejado (mov, valor, data)
  SELECT v.movimento_id, round(v.valor_vinculado, 2), m.data_transacao
    FROM public.conciliacao_vinculo v JOIN public.conciliacao_movimento m ON m.id = v.movimento_id
   WHERE v.lancamento_tabela = 'erp_receber' AND v.lancamento_id = p_receber_id AND m.status = 'conciliado'
  UNION ALL
  SELECT m.id, round(abs(m.valor), 2), m.data_transacao
    FROM public.conciliacao_movimento m
   WHERE m.lancamento_tabela = 'erp_receber' AND m.lancamento_id = p_receber_id AND m.status = 'conciliado'
     AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v
                      WHERE v.movimento_id = m.id AND v.lancamento_tabela = 'erp_receber' AND v.lancamento_id = p_receber_id);

  SELECT COALESCE(sum(valor), 0), count(*) INTO v_soma, v_n FROM _conc_desejado;
  IF v_n >= 2 AND v_soma > v_liq + 0.01 THEN
    RAISE EXCEPTION 'Conciliação excede o valor do título: % movimentos somam % para um líquido de %. Desvincule um antes.',
      v_n, to_char(v_soma,'FM999999990.00'), to_char(v_liq,'FM999999990.00') USING ERRCODE = '23514';
  END IF;

  -- a) baixas ligadas a créditos que NÃO estão mais conciliados neste título
  FOR x IN
    SELECT b.id, b.origem FROM public.erp_receber_baixa b
     WHERE b.receber_id = p_receber_id AND b.deleted_at IS NULL AND b.movimento_banco_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM _conc_desejado dd WHERE dd.mov = b.movimento_banco_id)
  LOOP
    IF x.origem = 'conciliacao' THEN
      UPDATE public.erp_receber_baixa SET deleted_at = now(), deleted_by = auth.uid() WHERE id = x.id;
    ELSE
      UPDATE public.erp_receber_baixa SET movimento_banco_id = NULL WHERE id = x.id;   -- manual: só solta o vínculo
    END IF;
  END LOOP;

  -- b) cada crédito conciliado tem a sua baixa (reaproveitando a manual quando for o mesmo dinheiro)
  FOR d IN SELECT * FROM _conc_desejado ORDER BY data, mov LOOP
    SELECT id INTO v_b FROM public.erp_receber_baixa
     WHERE receber_id = p_receber_id AND deleted_at IS NULL AND movimento_banco_id = d.mov
     ORDER BY criado_em LIMIT 1;
    IF v_b IS NOT NULL THEN
      UPDATE public.erp_receber_baixa SET valor = d.valor WHERE id = v_b AND round(valor, 2) <> d.valor;
      CONTINUE;
    END IF;

    SELECT id INTO v_b FROM public.erp_receber_baixa
     WHERE receber_id = p_receber_id AND deleted_at IS NULL AND movimento_banco_id IS NULL AND abs(valor - d.valor) < 0.01
     ORDER BY data, criado_em LIMIT 1;
    IF v_b IS NOT NULL THEN
      UPDATE public.erp_receber_baixa SET movimento_banco_id = d.mov WHERE id = v_b;   -- confirma o recebimento já registrado
      CONTINUE;
    END IF;

    SELECT COALESCE(sum(valor), 0) INTO v_ativas FROM public.erp_receber_baixa
     WHERE receber_id = p_receber_id AND deleted_at IS NULL;
    IF v_ativas + d.valor > v_liq + 0.01 THEN
      -- criar baixa sobrepagaria: o dinheiro já está registrado em baixas sem vínculo → liga-as (sem criar valor)
      v_falta := d.valor;
      FOR x IN SELECT id, valor FROM public.erp_receber_baixa
                WHERE receber_id = p_receber_id AND deleted_at IS NULL AND movimento_banco_id IS NULL AND valor > 0
                ORDER BY data, criado_em LOOP
        EXIT WHEN v_falta <= 0.01;
        UPDATE public.erp_receber_baixa SET movimento_banco_id = d.mov WHERE id = x.id;
        v_falta := v_falta - x.valor;
      END LOOP;
      CONTINUE;
    END IF;

    INSERT INTO public.erp_receber_baixa (receber_id, company_id, valor, data, forma, origem, movimento_banco_id, criado_por)
    VALUES (p_receber_id, r.company_id, d.valor, d.data, 'conciliacao_bancaria', 'conciliacao', d.mov, auth.uid());
  END LOOP;

  -- c) data/forma de pagamento acompanham as baixas (mesma semântica de antes: sem baixa → sem data)
  UPDATE public.erp_receber t
     SET data_pagamento = CASE WHEN COALESCE(t.valor_pago, 0) > 0
                               THEN (SELECT max(b.data) FROM public.erp_receber_baixa b WHERE b.receber_id = t.id AND b.deleted_at IS NULL)
                               ELSE NULL END,
         forma_pagamento = CASE WHEN COALESCE(t.valor_pago, 0) > 0
                                THEN COALESCE(NULLIF(t.forma_pagamento, ''),
                                              CASE WHEN v_n > 0 THEN 'conciliacao_bancaria' END)
                                ELSE t.forma_pagamento END,
         updated_at = now()
   WHERE t.id = p_receber_id
     AND ( t.data_pagamento IS DISTINCT FROM CASE WHEN COALESCE(t.valor_pago, 0) > 0
                               THEN (SELECT max(b.data) FROM public.erp_receber_baixa b WHERE b.receber_id = t.id AND b.deleted_at IS NULL)
                               ELSE NULL END
        OR (COALESCE(t.valor_pago, 0) > 0 AND NULLIF(t.forma_pagamento, '') IS NULL AND v_n > 0) );
END $function$;

REVOKE ALL ON FUNCTION public.fn_receber_conciliacao_sync(uuid) FROM PUBLIC, anon, authenticated;

-- 2) Recompute chamado pela trigger da conciliação: RECEBER passa pela sincronização das baixas.
--    PAGAR: inalterado (mesmo corpo de antes).
CREATE OR REPLACE FUNCTION public.fn_recompute_baixa_titulo(p_tabela text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_valor numeric; v_venc date; v_soma numeric; v_n int; v_dt date; v_status text;
        v_juros numeric; v_multa numeric; v_desc numeric; v_liquido numeric; v_company uuid;
        v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF p_id IS NULL OR p_tabela NOT IN ('erp_receber','erp_pagar') THEN RETURN; END IF;
  IF p_tabela = 'erp_receber' THEN SELECT company_id INTO v_company FROM public.erp_receber WHERE id = p_id;
  ELSE SELECT company_id INTO v_company FROM public.erp_pagar WHERE id = p_id; END IF;
  IF v_company IS NULL THEN RETURN; END IF;
  IF NOT (v_interno OR auth.role()='service_role' OR v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING errcode='42501';
  END IF;

  IF p_tabela = 'erp_receber' THEN
    PERFORM public.fn_receber_conciliacao_sync(p_id);   -- #38: baixas são a fonte; nunca sobrescreve a baixa manual
    RETURN;
  END IF;

  SELECT COALESCE(SUM(valor),0), count(*), max(data_transacao) INTO v_soma, v_n, v_dt
    FROM public.conciliacao_movimento
   WHERE lancamento_tabela = p_tabela AND lancamento_id = p_id AND status = 'conciliado';
  SELECT valor, data_vencimento, COALESCE(juros,0), COALESCE(multa,0), COALESCE(desconto,0)
    INTO v_valor, v_venc, v_juros, v_multa, v_desc FROM public.erp_pagar WHERE id = p_id;
  IF v_valor IS NULL THEN RETURN; END IF;
  v_liquido := round(v_valor + v_juros + v_multa - v_desc, 2);
  IF v_n >= 2 AND v_soma > v_liquido + 0.01 THEN
    RAISE EXCEPTION 'Conciliação excede o valor do título: % movimentos somam % para um líquido de %. Desvincule um antes.',
      v_n, to_char(v_soma,'FM999999990.00'), to_char(v_liquido,'FM999999990.00') USING ERRCODE = '23514';
  END IF;
  v_status := CASE WHEN v_soma <= 0 THEN (CASE WHEN v_venc < CURRENT_DATE THEN 'vencido' ELSE 'aberto' END)
    WHEN v_soma + 0.01 >= v_liquido THEN 'pago' ELSE 'parcial' END;
  UPDATE public.erp_pagar SET valor_pago = v_soma, status = v_status,
    data_pagamento = CASE WHEN v_soma > 0 THEN v_dt ELSE NULL END,
    forma_pagamento = CASE WHEN v_soma > 0 THEN COALESCE(NULLIF(forma_pagamento,''),'conciliacao_bancaria') ELSE NULL END,
    updated_at = now() WHERE id = p_id;
END $function$;

-- 3) Conciliação AGRUPADA (um crédito → vários títulos): receber pelas baixas.
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
  v_ja_pago boolean; v_liq numeric; v_pago numeric;
  v_receber uuid[] := '{}';
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
    -- receber: o acréscimo/desconto entra no valor vinculado do título-âncora (a baixa daquele crédito
    -- passa a ter o valor efetivamente recebido; a soma dos vínculos fecha com o extrato)
    if v_anchor_tab = 'erp_receber' then
      update conciliacao_vinculo set valor_vinculado = round(valor_vinculado + v_acr - v_desc, 2)
       where movimento_id = p_movimento_id and lancamento_tabela = 'erp_receber' and lancamento_id = v_anchor;
    end if;
  end if;

  for v_vin in select * from conciliacao_vinculo where movimento_id = p_movimento_id loop
    if v_vin.lancamento_tabela = 'erp_pagar' then
      select round(valor + coalesce(juros,0) - coalesce(desconto,0),2), coalesce(valor_pago,0)
        into v_liq, v_pago from erp_pagar where id = v_vin.lancamento_id;
      v_ja_pago := (v_pago + 0.01 >= v_liq);
      if v_ja_pago then
        update erp_pagar set conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
          where id = v_vin.lancamento_id;
      else
        update erp_pagar set status='pago',
          valor_pago = round(v_vin.valor_vinculado + case when v_vin.lancamento_id = v_anchor then v_acr - v_desc else 0 end, 2),
          data_pagamento = v_mov.data_transacao, forma_pagamento = coalesce(forma_pagamento, 'cartao_credito'),
          conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
         where id = v_vin.lancamento_id;
      end if;
    else
      -- #38: receber não grava mais valor_pago aqui; a baixa nasce (ou é reaproveitada) no sync abaixo
      update erp_receber set conciliado = true, movimento_banco_id = p_movimento_id, updated_at = now()
        where id = v_vin.lancamento_id;
      v_receber := array_append(v_receber, v_vin.lancamento_id);
    end if;
    v_qtd := v_qtd + 1;
  end loop;

  update conciliacao_movimento set status='conciliado', match_origem='agrupado',
    match_aplicado_em=now(), match_aplicado_por=p_operador_id where id = p_movimento_id;

  perform public.fn_receber_conciliacao_sync(x) from unnest(v_receber) x;

  return jsonb_build_object('ok', true, 'conciliado', true, 'qtd_baixados', v_qtd,
    'valor', v_mov.valor, 'acrescimo', v_acr, 'desconto', v_desc, 'ajuste_lancamento', v_anchor);
end;
$function$;

-- 4) Desvincular crédito AGRUPADO: receber pelas baixas (a manual volta a ficar "pago aguardando conciliação").
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
  v_novo_pago  numeric;
  v_liq        numeric;
  v_venc       date;
  v_status     text;
  v_receber    uuid[] := '{}';
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
      IF v_vin.lancamento_tabela = 'erp_pagar' THEN
        SELECT round(GREATEST(COALESCE(valor_pago,0) - v_vin.valor_vinculado, 0), 2),
               round(valor + COALESCE(juros,0) - COALESCE(desconto,0), 2), data_vencimento
          INTO v_novo_pago, v_liq, v_venc
          FROM public.erp_pagar WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
        IF v_liq IS NULL THEN CONTINUE; END IF;
        v_status := CASE WHEN v_novo_pago <= 0.01 THEN (CASE WHEN v_venc < CURRENT_DATE THEN 'vencido' ELSE 'aberto' END)
                         WHEN v_novo_pago + 0.01 >= v_liq THEN 'pago' ELSE 'parcial' END;
        UPDATE public.erp_pagar SET
          valor_pago = v_novo_pago, status = v_status,
          data_pagamento  = CASE WHEN v_novo_pago > 0.01 THEN data_pagamento  ELSE NULL END,
          forma_pagamento = CASE WHEN v_novo_pago > 0.01 THEN forma_pagamento ELSE NULL END,
          conciliado = false, movimento_banco_id = NULL, updated_at = now()
        WHERE id = v_vin.lancamento_id AND company_id = v_mov.company_id;
      ELSE
        -- #38: receber não subtrai valor_pago; o sync (após limpar os vínculos) desfaz só o que a conciliação fez
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

-- 5) Aplicar match: RECEBER pontua o valor pelo valor de referência (cheio, saldo ou baixa sem vínculo).
--    Resto do corpo inalterado.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_aplicar_match(p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid, p_origem text DEFAULT 'manual'::text, p_motivo text DEFAULT NULL::text)
 RETURNS TABLE(movimento_id uuid, status_resultado text, mensagem text)
 LANGUAGE plpgsql
AS $function$
-- OUT column "movimento_id" (RETURNS TABLE) colide com a coluna conciliacao_vinculo.movimento_id no
-- INSERT abaixo → "column reference is ambiguous". use_column faz o plpgsql preferir a COLUNA no INSERT.
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
    SELECT CASE WHEN abs(p.valor - v_mov.valor) < 0.01 THEN 50 ELSE 25 END
         + CASE WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30 ELSE 10 END + 20
      INTO v_score FROM erp_pagar p WHERE p.id = p_lancamento_id;
  ELSE
    -- #38: o crédito pode estar pagando o saldo ou confirmando uma baixa já registrada — não só o valor cheio
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

  -- #38: baixa ⟺ vínculo ATÔMICO. O UPDATE acima já dispara a baixa (trigger → recompute a partir do
  -- movimento). Aqui garantimos que o VÍNCULO exista SEMPRE que o título é baixado por conciliação —
  -- inclusive na auto-conciliação/aplicar-sugestão, que antes baixava sem gerar vínculo (órfão).
  -- Idempotente: quando fn_conciliacao_vincular já inseriu o vínculo, o ON CONFLICT só reafirma o valor.
  INSERT INTO conciliacao_vinculo (movimento_id, company_id, lancamento_tabela, lancamento_id, valor_vinculado, criado_por)
  VALUES (p_movimento_id, v_mov.company_id, p_lancamento_tabela, p_lancamento_id, round(abs(v_mov.valor),2), p_operador_id)
  ON CONFLICT (movimento_id, lancamento_tabela, lancamento_id) DO UPDATE SET valor_vinculado = EXCLUDED.valor_vinculado;

  -- carimbo "Conciliado" (o trigger de baixa já rodou no UPDATE acima; aqui só marca o booleano derivado)
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

-- 6) Sugestão de match: RECEBER pontua pelo valor de referência e inclui títulos PARCIAIS.
--    Pagar: inalterado.
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
      p.valor::numeric valor_lanc, p.valor::numeric valor_ref, COALESCE(p.descricao,p.fornecedor_nome,'')::text desc_lanc,
      p.fornecedor_nome::text contrap, p.status::text status_lanc,
      (v_mov_forma IS NOT NULL AND lower(COALESCE(p.forma_pagamento,'')) ~ v_mov_forma) AS forma_conf,
      false AS forma_inf,
      ( CASE WHEN abs(p.valor-v_mov.valor)<0.01 THEN 50 WHEN abs(p.valor-v_mov.valor)<=1 THEN 40
             WHEN abs(p.valor-v_mov.valor)<=10 THEN 25
             WHEN abs(p.valor-v_mov.valor)/NULLIF(v_mov.valor,0)<0.05 THEN 15 ELSE 0 END
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
    WHERE p.company_id=v_mov.company_id AND p.status IN ('aberto','vencido','pago')
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
