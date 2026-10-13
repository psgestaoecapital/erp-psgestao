-- ============================================================
-- #29 · retorno de remessa: codigo desconhecido NUNCA liquida
-- A decisao de liquidar sai do frontend e vai para o BANCO. O front le o arquivo e reporta o que
-- viu (ocorrencia, data, valor); QUEM DECIDE o efeito e o banco de dados, consultando o mapa. Um
-- parser de arquivo nao pode ter autoridade para dar baixa em titulo.
-- Causa raiz: fn_remessa_retorno_processar decidia por 'pago_hint' (calculado no front) e NUNCA
-- consultava erp_remessa_ocorrencia_mapa. O front viu '000', mandou pago_hint=true, e o 'YC'
-- (nao mapeado) viajou na string sem ninguem olhar -> conta marcada como paga sem ter sido paga.
-- ============================================================

-- 2.1 estado proprio para o que o sistema nao entendeu.
--   NOTA (RD-38): a constraint atual ja inclui 'enviado' e 'agendado' — PRESERVADOS aqui; o SPEC
--   literal os omitia. So ACRESCENTAMOS 'nao_reconhecido' (nada existente muda).
ALTER TABLE public.erp_remessa_pagamento_item
  DROP CONSTRAINT IF EXISTS erp_remessa_pagamento_item_status_item_check;
ALTER TABLE public.erp_remessa_pagamento_item
  ADD CONSTRAINT erp_remessa_pagamento_item_status_item_check
  CHECK (status_item IN ('incluido','enviado','agendado','pago','rejeitado','pendente','nao_reconhecido'));
COMMENT ON COLUMN public.erp_remessa_pagamento_item.status_item IS
  'nao_reconhecido = o banco devolveu ocorrencia que nao esta em erp_remessa_ocorrencia_mapa. '
  'NUNCA liquida: o titulo volta ao status pre-remessa e o item entra na fila de revisao.';

-- 2.2 quando o retorno foi lido, e o que nao foi entendido
ALTER TABLE public.erp_remessa_pagamento
  ADD COLUMN IF NOT EXISTS retorno_arquivo_nome text,
  ADD COLUMN IF NOT EXISTS itens_nao_reconhecidos int NOT NULL DEFAULT 0;

-- 2.3 resolver ocorrencia -> efeito, UM lugar so.
--   Tokeniza por separador (000/YC -> 000, YC). Um token que o mapa nao conhece INTEIRO e cujo
--   comprimento e par > 2 e quebrado em pares de 2 (codigos concatenados, ex.: 0003 -> 00, 03);
--   os demais ficam inteiros (000 fica 000; YC fica YC). REGRA 1: qualquer codigo desconhecido
--   manda (nao liquida). REGRA 2: entre os conhecidos, o mais restritivo vence.
CREATE OR REPLACE FUNCTION public.fn_remessa_ocorrencia_efeito(
  p_banco_codigo text, p_ocorrencia text, p_cod_movimento text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_occ text := upper(COALESCE(btrim(p_ocorrencia),''));
  v_mov text := upper(COALESCE(btrim(p_cod_movimento),''));
  v_cods text[]; v_desconhecidos text[]; v_efeito text; v_desc text;
BEGIN
  IF v_occ = '' AND v_mov = '' THEN
    RETURN jsonb_build_object('efeito','nao_reconhecido',
      'motivo','retorno sem codigo de ocorrencia', 'codigos', '[]'::jsonb);
  END IF;

  WITH tok AS (
    SELECT btrim(t) AS t FROM unnest(regexp_split_to_array(v_occ, '[^A-Z0-9]+')) AS t WHERE btrim(t) <> ''
    UNION SELECT v_mov WHERE v_mov <> ''
  ), classif AS (
    SELECT tok.t AS orig,
           CASE
             WHEN EXISTS (SELECT 1 FROM erp_remessa_ocorrencia_mapa m WHERE m.banco_codigo = p_banco_codigo AND m.codigo = tok.t) THEN tok.t
             WHEN length(tok.t) > 2 AND length(tok.t) % 2 = 0 THEN NULL  -- concatenado: quebra abaixo
             ELSE tok.t
           END AS c
      FROM tok
  ), final AS (
    SELECT c FROM classif WHERE c IS NOT NULL
    UNION
    SELECT substr(c.orig, g, 2) FROM classif c, generate_series(1, GREATEST(length(c.orig)-1,1), 2) AS g
      WHERE c.c IS NULL
  )
  SELECT array_agg(DISTINCT c) INTO v_cods FROM final WHERE btrim(COALESCE(c,'')) <> '';

  SELECT array_agg(c) INTO v_desconhecidos FROM unnest(v_cods) AS c
   WHERE NOT EXISTS (SELECT 1 FROM erp_remessa_ocorrencia_mapa m
                      WHERE m.banco_codigo = p_banco_codigo AND m.codigo = c);

  -- REGRA 1: qualquer codigo desconhecido manda. Nao liquida.
  IF COALESCE(array_length(v_desconhecidos,1),0) > 0 THEN
    RETURN jsonb_build_object(
      'efeito','nao_reconhecido',
      'motivo','o banco devolveu codigo que o sistema nao conhece: ' ||
               array_to_string(v_desconhecidos, ', '),
      'codigos', to_jsonb(v_cods), 'desconhecidos', to_jsonb(v_desconhecidos));
  END IF;

  -- REGRA 2: entre os conhecidos, o mais restritivo vence
  SELECT m.efeito, m.descricao INTO v_efeito, v_desc
    FROM erp_remessa_ocorrencia_mapa m
   WHERE m.banco_codigo = p_banco_codigo AND m.codigo = ANY(v_cods)
   ORDER BY CASE m.efeito WHEN 'rejeitar' THEN 0 WHEN 'agendar' THEN 1
                          WHEN 'confirmar' THEN 2 WHEN 'liquidar' THEN 3 ELSE 4 END
   LIMIT 1;
  RETURN jsonb_build_object('efeito', COALESCE(v_efeito,'nao_reconhecido'),
    'motivo', v_desc, 'codigos', to_jsonb(v_cods));
END $function$;

-- 2.4 fn_remessa_retorno_processar v2 — o efeito vem do BANCO, nao mais do front.
--   Preservado: guard de empresa, idempotencia do 'pago', divergencia de valor, a chamada a
--   fn_pagar_baixar_pagamento e a atualizacao do status da remessa. pago_hint deixa de decidir:
--   so serve de salvaguarda adicional (efeito=liquidar sem data/valor NAO baixa).
CREATE OR REPLACE FUNCTION public.fn_remessa_retorno_processar(p_remessa_id uuid, p_company_id uuid, p_itens jsonb, p_conta_bancaria_id uuid DEFAULT NULL::uuid, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rem record; v_el jsonb; v_item record; v_pagar record;
  v_val_pago numeric; v_dt date; v_ocorr text; v_hint boolean;
  v_banco text; v_ef jsonb; v_efeito text;
  v_saldo numeric; v_resultado text; v_motivo text; v_baixa jsonb;
  v_pagos int := 0; v_rej int := 0; v_div int := 0; v_ja int := 0; v_err int := 0;
  v_agen int := 0; v_nrec int := 0; v_total int := 0;
  v_detalhes jsonb := '[]'::jsonb; v_status_novo text; v_arquivo text;
BEGIN
  SELECT * INTO v_rem FROM erp_remessa_pagamento WHERE id = p_remessa_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Remessa não encontrada.'); END IF;
  IF v_rem.company_id <> p_company_id THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Remessa não pertence à empresa selecionada.');
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    v_total := v_total + 1;
    v_val_pago := round(COALESCE((v_el->>'val_pago')::numeric, 0), 2);
    v_dt       := NULLIF(v_el->>'dt_pagamento','')::date;
    v_ocorr    := COALESCE(v_el->>'ocorrencia','');
    v_hint     := COALESCE((v_el->>'pago_hint')::boolean, false);
    v_banco    := COALESCE(NULLIF(v_el->>'banco_codigo',''), '748');
    v_arquivo  := COALESCE(v_arquivo, NULLIF(v_el->>'arquivo_nome',''));
    v_resultado := NULL; v_motivo := NULL;

    SELECT * INTO v_item FROM erp_remessa_pagamento_item
     WHERE id = (v_el->>'item_id')::uuid AND remessa_id = p_remessa_id;
    IF NOT FOUND THEN
      v_resultado := 'nao_casado'; v_motivo := 'item não pertence a esta remessa';
      v_detalhes := v_detalhes || jsonb_build_object('item_id', v_el->>'item_id', 'resultado', v_resultado, 'motivo', v_motivo);
      CONTINUE;
    END IF;
    SELECT * INTO v_pagar FROM erp_pagar WHERE id = v_item.erp_pagar_id;

    -- QUEM DECIDE O EFEITO E O BANCO (o mapa), nao mais o front (#29).
    v_ef := public.fn_remessa_ocorrencia_efeito(v_banco, v_ocorr, v_el->>'cod_movimento');
    v_efeito := v_ef->>'efeito';

    IF v_item.status_item = 'pago' THEN
      v_ja := v_ja + 1; v_resultado := 'ja_pago'; v_motivo := 'já baixado por um retorno anterior (idempotente)';

    ELSIF v_efeito = 'nao_reconhecido' THEN
      -- codigo desconhecido NUNCA liquida. O titulo VOLTA ao estado anterior a remessa.
      v_nrec := v_nrec + 1; v_resultado := 'nao_reconhecido'; v_motivo := v_ef->>'motivo';
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item
           SET status_item = 'nao_reconhecido', ocorrencia_retorno = v_ocorr, remocao_motivo = v_motivo
         WHERE id = v_item.id;
        UPDATE erp_pagar SET status = COALESCE(status_pre_remessa, 'aberto')
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
      END IF;

    ELSIF v_efeito = 'agendar' THEN
      v_agen := v_agen + 1; v_resultado := 'agendado';
      v_motivo := COALESCE(NULLIF(v_ef->>'motivo',''), 'agendado pelo banco');
      IF p_confirmar THEN
        UPDATE erp_pagar SET status_pre_remessa = COALESCE(status_pre_remessa, status), status = 'agendado'
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
        UPDATE erp_remessa_pagamento_item SET status_item = 'agendado', ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
      END IF;

    ELSIF v_efeito = 'confirmar' THEN
      v_resultado := 'confirmado'; v_motivo := 'confirmação de recebimento (sem baixa)';
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item SET ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
      END IF;

    ELSIF v_efeito <> 'liquidar' THEN
      -- rejeitar (mapeado): reverte pro status pre-remessa
      v_rej := v_rej + 1; v_resultado := 'rejeitado';
      v_motivo := 'rejeitado pelo banco · ocorrência ' || COALESCE(NULLIF(v_ocorr,''),'—')
                  || COALESCE(' — ' || NULLIF(v_ef->>'motivo',''), '');
      IF p_confirmar THEN
        UPDATE erp_pagar SET status = COALESCE(status_pre_remessa, 'aberto')
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
        UPDATE erp_remessa_pagamento_item SET status_item = 'rejeitado', ocorrencia_retorno = v_ocorr, remocao_motivo = v_motivo WHERE id = v_item.id;
      END IF;

    ELSIF NOT v_hint OR v_val_pago <= 0 OR v_dt IS NULL THEN
      -- liquidar, mas o parser NAO viu data/valor: salvaguarda adicional, NAO baixa.
      v_rej := v_rej + 1; v_resultado := 'rejeitado';
      v_motivo := 'banco liquidou mas sem data/valor confirmados no retorno · ocorrência ' || COALESCE(v_ocorr,'—');
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item SET status_item = 'rejeitado', ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
      END IF;

    ELSE
      -- liquidar com data/valor: mantem a checagem de divergencia e a baixa.
      v_saldo := round(COALESCE(v_pagar.valor,0) - COALESCE(v_pagar.valor_pago,0), 2);
      IF abs(v_val_pago - v_saldo) > 0.01 THEN
        v_div := v_div + 1; v_resultado := 'divergente';
        v_motivo := 'valor do retorno (R$ ' || trim(to_char(v_val_pago,'FM999999990.00')) ||
                    ') difere do saldo do título (R$ ' || trim(to_char(v_saldo,'FM999999990.00')) || ') — não baixado';
        IF p_confirmar THEN
          UPDATE erp_remessa_pagamento_item
             SET status_item = 'pendente',
                 ocorrencia_retorno = 'DIVERG val=' || trim(to_char(v_val_pago,'FM999999990.00')) ||
                                      ' saldo=' || trim(to_char(v_saldo,'FM999999990.00')) ||
                                      CASE WHEN v_ocorr <> '' THEN ' · ' || v_ocorr ELSE '' END
           WHERE id = v_item.id;
        END IF;
      ELSE
        IF p_confirmar THEN
          v_baixa := fn_pagar_baixar_pagamento(v_item.erp_pagar_id, v_dt, p_conta_bancaria_id, v_item.forma, v_val_pago);
          IF COALESCE((v_baixa->>'sucesso')::boolean, false) THEN
            v_pagos := v_pagos + 1; v_resultado := 'pago'; v_motivo := 'baixado';
            UPDATE erp_remessa_pagamento_item SET status_item = 'pago', ocorrencia_retorno = v_ocorr WHERE id = v_item.id;
          ELSE
            v_err := v_err + 1; v_resultado := 'erro_baixa'; v_motivo := COALESCE(v_baixa->>'erro','falha na baixa');
            UPDATE erp_remessa_pagamento_item
               SET status_item = 'pendente', ocorrencia_retorno = 'ERRO_BAIXA: ' || v_motivo WHERE id = v_item.id;
          END IF;
        ELSE
          v_pagos := v_pagos + 1; v_resultado := 'pago'; v_motivo := 'será baixado';
        END IF;
      END IF;
    END IF;

    v_detalhes := v_detalhes || jsonb_build_object(
      'item_id', v_item.id, 'pagar_id', v_item.erp_pagar_id, 'resultado', v_resultado, 'efeito', v_efeito,
      'val_pago', v_val_pago, 'val_titulo', v_pagar.valor,
      'saldo', round(COALESCE(v_pagar.valor,0) - COALESCE(v_pagar.valor_pago,0), 2),
      'ocorrencia', v_ocorr, 'motivo', v_motivo);
  END LOOP;

  IF p_confirmar THEN
    SELECT CASE WHEN count(*) FILTER (WHERE status_item <> 'pago') = 0 THEN 'concluido' ELSE 'retorno_parcial' END
      INTO v_status_novo FROM erp_remessa_pagamento_item WHERE remessa_id = p_remessa_id;
    UPDATE erp_remessa_pagamento
       SET retorno_importado_em = now(), status = v_status_novo,
           retorno_arquivo_nome = COALESCE(v_arquivo, retorno_arquivo_nome),
           itens_nao_reconhecidos = (SELECT count(*) FROM erp_remessa_pagamento_item
                                      WHERE remessa_id = p_remessa_id AND status_item = 'nao_reconhecido')
     WHERE id = p_remessa_id;
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true, 'confirmado', p_confirmar,
    'remessa_status', v_status_novo,
    'resumo', jsonb_build_object('total', v_total, 'pagos', v_pagos, 'agendados', v_agen, 'rejeitados', v_rej,
                                 'divergentes', v_div, 'ja_pagos', v_ja, 'nao_reconhecidos', v_nrec, 'erros', v_err),
    'detalhes', v_detalhes);
END; $function$;

-- 2.5 fn_remessa_retorno_conciliar_auto v2 — o efeito tambem vem de fn_remessa_ocorrencia_efeito
--   (decisao do CEO 08/09): codigo desconhecido vira 'nao_reconhecido' (nao mais 'rejeitar' cego),
--   com mensagem honesta ("o banco devolveu X que o sistema nao conhece") e o titulo de volta ao
--   pre-remessa + na fila de revisao. Tudo o mais preservado: casamento por barra/chave/documento,
--   idempotencia, salvaguarda de liquidar-sem-data/valor, agendar, confirmar, rejeitar.
CREATE OR REPLACE FUNCTION public.fn_remessa_retorno_conciliar_auto(p_company_id uuid, p_itens jsonb, p_confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_el jsonb; v_item RECORD;
  v_barra text; v_chave text; v_doc text;
  v_val_tit numeric; v_val_pago numeric; v_dt date; v_ocorr text; v_hint boolean;
  v_codmov text; v_occ text; v_banco text;
  v_ef jsonb; v_efeito text; v_efdesc text;
  v_resultado text; v_motivo text; v_baixa jsonb;
  v_matched uuid[] := '{}';
  v_casados jsonb := '[]'::jsonb;
  v_agendados jsonb := '[]'::jsonb;
  v_naocasados jsonb := '[]'::jsonb;
  v_rejeitados jsonb := '[]'::jsonb;
  v_japagos jsonb := '[]'::jsonb;
  v_naorec jsonb := '[]'::jsonb;
  v_total int:=0; v_pagos int:=0; v_agen int:=0; v_rej int:=0; v_ja int:=0; v_err int:=0; v_nc int:=0; v_nrec int:=0;
BEGIN
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    v_total := v_total + 1;
    v_barra    := regexp_replace(COALESCE(v_el->>'codigo_barras',''), '\D', '', 'g');
    v_chave    := NULLIF(v_el->>'chave_pix','');
    v_doc      := NULLIF(v_el->>'documento','');
    v_val_tit  := round(COALESCE((v_el->>'valor')::numeric, 0), 2);
    v_val_pago := round(COALESCE((v_el->>'valor_pago')::numeric, 0), 2);
    v_dt       := NULLIF(v_el->>'data_pagamento','')::date;
    v_ocorr    := COALESCE(v_el->>'ocorrencia','');
    v_hint     := COALESCE((v_el->>'pago_hint')::boolean, (v_dt IS NOT NULL AND v_val_pago > 0));
    v_codmov   := upper(regexp_replace(COALESCE(v_el->>'cod_movimento',''), '\s', '', 'g'));
    v_occ      := upper(regexp_replace(COALESCE(v_el->>'ocorrencias',''),  '\s', '', 'g'));
    v_banco    := COALESCE(NULLIF(v_el->>'banco_codigo',''), '748');

    SELECT i.id AS item_id, i.remessa_id, i.erp_pagar_id, i.valor AS item_valor, i.status_item,
           r.numero_sequencial, p.descricao, p.status AS pstatus, p.status_pre_remessa AS ppre
      INTO v_item
    FROM erp_remessa_pagamento_item i
    JOIN erp_remessa_pagamento r ON r.id = i.remessa_id AND r.company_id = p_company_id AND r.status <> 'cancelado'
    JOIN (SELECT * FROM public.erp_pagar WHERE deleted_at IS NULL) p ON p.id = i.erp_pagar_id
    WHERE i.removido_em IS NULL
      AND NOT (i.id = ANY(v_matched))
      AND (
            (v_barra <> '' AND regexp_replace(COALESCE(p.codigo_barras,''), '\D','','g') = v_barra)
         OR (v_chave IS NOT NULL AND COALESCE(i.chave_pix, p.chave_pix) = v_chave AND round(i.valor,2) = v_val_tit)
         OR (v_doc   IS NOT NULL AND p.numero_documento = v_doc AND round(i.valor,2) = v_val_tit)
      )
    ORDER BY (CASE WHEN i.status_item <> 'pago' AND p.status <> 'pago' THEN 0 ELSE 1 END),
             r.numero_sequencial DESC
    LIMIT 1;

    IF NOT FOUND THEN
      v_nc := v_nc + 1;
      v_naocasados := v_naocasados || jsonb_build_object(
        'valor', v_val_tit, 'valor_pago', v_val_pago, 'codigo_barras', NULLIF(v_barra,''),
        'chave_pix', v_chave, 'ocorrencia', v_ocorr, 'motivo', 'não encontrei título correspondente');
      CONTINUE;
    END IF;
    v_matched := v_matched || v_item.item_id;

    IF v_item.status_item = 'pago' OR v_item.pstatus = 'pago' THEN
      v_ja := v_ja + 1;
      v_japagos := v_japagos || jsonb_build_object('item_id', v_item.item_id, 'remessa', v_item.numero_sequencial,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'motivo', 'título já baixado');
      CONTINUE;
    END IF;

    -- DE-PARA: o efeito vem do banco (fn_remessa_ocorrencia_efeito), sobre os codigos reais (ocorrencias
    -- concatenadas + cod_movimento). Codigo desconhecido => 'nao_reconhecido' (nunca liquida, e nomeado).
    v_ef := public.fn_remessa_ocorrencia_efeito(v_banco, v_occ, v_codmov);
    v_efeito := v_ef->>'efeito'; v_efdesc := v_ef->>'motivo';
    -- salvaguarda: liquidar SEM data/valor confirmados pelo banco NAO baixa (nunca baixa cego)
    IF v_efeito = 'liquidar' AND (NOT v_hint OR v_val_pago <= 0 OR v_dt IS NULL) THEN
      v_efeito := 'rejeitar';
      v_efdesc := COALESCE(NULLIF(v_efdesc,'')||' · ','') || 'liquidação sem data/valor do banco';
    END IF;

    IF v_efeito = 'nao_reconhecido' THEN
      v_nrec := v_nrec + 1;
      v_motivo := COALESCE(NULLIF(v_efdesc,''), 'ocorrência não reconhecida');
      IF p_confirmar THEN
        UPDATE erp_pagar
           SET status = COALESCE(status_pre_remessa, 'aberto')
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
        UPDATE erp_remessa_pagamento_item
           SET status_item='nao_reconhecido', ocorrencia_retorno=v_ocorr, remocao_motivo=v_motivo
         WHERE id=v_item.item_id;
      END IF;
      v_naorec := v_naorec || jsonb_build_object(
        'item_id', v_item.item_id, 'remessa', v_item.numero_sequencial, 'pagar_id', v_item.erp_pagar_id,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'ocorrencia', v_ocorr, 'motivo', v_motivo);

    ELSIF v_efeito = 'liquidar' THEN
      v_resultado := 'pago'; v_motivo := 'será baixado';
      IF p_confirmar THEN
        v_baixa := fn_pagar_baixar_pagamento(v_item.erp_pagar_id, v_dt, NULL, 'cnab', v_item.item_valor);
        IF COALESCE((v_baixa->>'sucesso')::boolean, false) THEN
          v_motivo := 'baixado';
          UPDATE erp_remessa_pagamento_item SET status_item='pago', ocorrencia_retorno=v_ocorr WHERE id=v_item.item_id;
        ELSE
          v_resultado := 'erro_baixa'; v_err := v_err + 1; v_motivo := COALESCE(v_baixa->>'erro','falha na baixa');
          UPDATE erp_remessa_pagamento_item SET ocorrencia_retorno='ERRO_BAIXA: '||v_motivo WHERE id=v_item.item_id;
        END IF;
      END IF;
      IF v_resultado = 'pago' THEN v_pagos := v_pagos + 1; END IF;
      v_casados := v_casados || jsonb_build_object(
        'item_id', v_item.item_id, 'remessa', v_item.numero_sequencial, 'pagar_id', v_item.erp_pagar_id,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'valor_pago', v_val_pago,
        'resultado', v_resultado, 'ocorrencia', v_ocorr, 'motivo', v_motivo);

    ELSIF v_efeito = 'agendar' THEN
      v_agen := v_agen + 1;
      IF p_confirmar THEN
        UPDATE erp_pagar
           SET status_pre_remessa = COALESCE(status_pre_remessa, status), status = 'agendado'
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
        UPDATE erp_remessa_pagamento_item SET status_item='agendado', ocorrencia_retorno=v_ocorr WHERE id=v_item.item_id;
      END IF;
      v_agendados := v_agendados || jsonb_build_object(
        'item_id', v_item.item_id, 'remessa', v_item.numero_sequencial, 'pagar_id', v_item.erp_pagar_id,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'ocorrencia', v_ocorr,
        'motivo', 'agendado pelo banco' || COALESCE(' · '||NULLIF(v_efdesc,''), ''));

    ELSIF v_efeito = 'confirmar' THEN
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item SET ocorrencia_retorno=v_ocorr WHERE id=v_item.item_id;
      END IF;
      v_agendados := v_agendados || jsonb_build_object(
        'item_id', v_item.item_id, 'remessa', v_item.numero_sequencial, 'pagar_id', v_item.erp_pagar_id,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'ocorrencia', v_ocorr,
        'motivo', 'confirmação de recebimento (sem baixa)');

    ELSE  -- rejeitar (mapeado): reverte pro status pre-remessa + motivo visivel
      v_rej := v_rej + 1;
      v_motivo := 'rejeitado pelo banco · ocorrência '
                  || COALESCE(NULLIF(v_ocorr,''), NULLIF(v_codmov,''), NULLIF(v_occ,''), '—')
                  || COALESCE(' — '||NULLIF(v_efdesc,''), '');
      IF p_confirmar THEN
        UPDATE erp_pagar
           SET status = COALESCE(status_pre_remessa, 'aberto')
         WHERE id = v_item.erp_pagar_id AND company_id = p_company_id AND status NOT IN ('pago','cancelado');
        UPDATE erp_remessa_pagamento_item
           SET status_item='rejeitado', ocorrencia_retorno=v_ocorr, remocao_motivo=v_motivo
         WHERE id=v_item.item_id;
      END IF;
      v_rejeitados := v_rejeitados || jsonb_build_object(
        'item_id', v_item.item_id, 'remessa', v_item.numero_sequencial, 'pagar_id', v_item.erp_pagar_id,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'ocorrencia', v_ocorr, 'motivo', v_motivo);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'confirmado', p_confirmar,
    'casados', v_casados, 'agendados', v_agendados, 'nao_casados', v_naocasados,
    'rejeitados', v_rejeitados, 'ja_pagos', v_japagos, 'nao_reconhecidos', v_naorec,
    'qtd_casados', jsonb_array_length(v_casados), 'qtd_agendados', jsonb_array_length(v_agendados),
    'qtd_nao_casados', jsonb_array_length(v_naocasados), 'qtd_nao_reconhecidos', jsonb_array_length(v_naorec),
    'resumo', jsonb_build_object('total', v_total, 'pagos', v_pagos, 'agendados', v_agen, 'rejeitados', v_rej,
              'ja_pagos', v_ja, 'erros', v_err, 'nao_casados', v_nc, 'nao_reconhecidos', v_nrec));
END $function$;
