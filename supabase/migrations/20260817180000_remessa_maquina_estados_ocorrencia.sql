-- Remessa · máquina de estados por ocorrência CNAB240 (RD-41, validado com a Jordana em 17/08)
--
-- Ciclo: aberto → INCLUIDO_NA_REMESSA → AGENDADO → PAGO, com desvio pra REJEITADO (reverte + motivo).
-- Nunca baixar cego; nunca esconder rejeição. Auditado (RD-38): o motor REAL do retorno é
-- fn_remessa_retorno_conciliar_auto (é o que a tela chama), não o fn_remessa_retorno_processar citado
-- no SPEC — a UI casa por código de barras atravessando todas as remessas. Este migration mexe no motor
-- real + no que a feature exige na base (descoberto na auditoria): a constraint de status, o trigger que
-- recalcula status, a view consolidada (status_calculado) e o de-para de ocorrência.
--
-- ⚠️ Mexe em status de contas a pagar REAIS (dinheiro). Mudanças são ADITIVAS/cirúrgicas. Reauditoria
-- profunda pós-merge (RD-53) com a Jordana em KGF antes de confiar.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Status novos na conta a pagar + campo de reversão
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.erp_pagar DROP CONSTRAINT IF EXISTS erp_pagar_status_check;
ALTER TABLE public.erp_pagar ADD CONSTRAINT erp_pagar_status_check
  CHECK (status IN ('aberto','pago','parcial','vencido','cancelado','incluido_remessa','agendado'));

-- guarda o status que a conta tinha ANTES de entrar na remessa, pra a rejeição reverter exatamente pra ele
ALTER TABLE public.erp_pagar ADD COLUMN IF NOT EXISTS status_pre_remessa text;

-- 'agendado' também como status do ITEM da remessa (extrato)
DO $mig$
DECLARE v_con text;
BEGIN
  SELECT con.conname INTO v_con
  FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
  WHERE c.relname='erp_remessa_pagamento_item' AND con.contype='c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status_item%' LIMIT 1;
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.erp_remessa_pagamento_item DROP CONSTRAINT %I', v_con);
  END IF;
END $mig$;
ALTER TABLE public.erp_remessa_pagamento_item ADD CONSTRAINT erp_remessa_pagamento_item_status_item_check
  CHECK (status_item IN ('incluido','enviado','pago','rejeitado','pendente','agendado'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Trigger de status: PRESERVA incluido_remessa/agendado enquanto não há pagamento.
--    Sem isto, todo UPDATE OF status jogava o título de volta pra aberto/vencido e apagava o estado
--    de remessa. Quando o pagamento chega (valor_pago>0 / saldo<=0) volta a virar pago/parcial normal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_status_lancamento()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_liquido numeric; v_saldo numeric;
BEGIN
  -- estados terminais MANUAIS não são recomputados
  IF LOWER(TRIM(COALESCE(NEW.status,''))) IN ('cancelado','cancelled','canceled','renegociado','estornado') THEN
    RETURN NEW;
  END IF;
  -- valor efetivamente devido = valor + juros + multa − desconto (fonte única do saldo · RD-52)
  v_liquido := COALESCE(NEW.valor,0) + COALESCE(NEW.juros,0) + COALESCE(NEW.multa,0) - COALESCE(NEW.desconto,0);
  v_saldo   := round(v_liquido - COALESCE(NEW.valor_pago,0), 2);
  IF v_saldo <= 0.01 THEN
    NEW.status := 'pago';                                        -- quitada
    NEW.data_pagamento := COALESCE(NEW.data_pagamento, CURRENT_DATE);
  ELSIF COALESCE(NEW.valor_pago,0) > 0 THEN
    NEW.status := 'parcial';                                     -- pagou parte
  ELSIF NEW.status IN ('incluido_remessa','agendado') THEN
    -- estados de remessa (setados pelas RPCs) são preservados enquanto não houver pagamento · RD-41
    RETURN NEW;
  ELSE
    NEW.status := fn_calcular_status_lancamento(NEW.data_vencimento, NEW.data_pagamento, NEW.status); -- aberto/vencido
  END IF;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) View consolidada: status_calculado passa os status novos ANTES da lógica de data.
--    (o 'agendado' por data_previsao — previsão de caixa — continua funcionando; o agendado
--     de remessa/banco também cai em 'agendado', o que é coerente pro filtro/rótulo.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_titulos_consolidados AS
 SELECT p.id, p.company_id, 'pagar'::text AS tipo, p.descricao,
    p.fornecedor_nome AS contraparte_nome, p.fornecedor_id AS contraparte_id, p.categoria,
    p.valor, p.valor_pago, p.data_emissao, p.data_vencimento, p.data_pagamento, p.data_previsao,
    p.status, p.numero_documento, p.numero_nf, p.linha_negocio, p.created_at, p.updated_at,
    CASE
      WHEN p.status::text = 'pago'::text THEN 'pago'::text
      WHEN p.status::text = 'cancelado'::text THEN 'cancelado'::text
      WHEN p.status::text = 'incluido_remessa'::text THEN 'incluido_remessa'::text
      WHEN p.status::text = 'agendado'::text THEN 'agendado'::text
      WHEN p.data_vencimento < CURRENT_DATE THEN 'vencido'::text
      WHEN p.data_previsao IS NOT NULL AND p.status::text = 'aberto'::text THEN 'agendado'::text
      ELSE 'aberto'::text
    END AS status_calculado
   FROM erp_pagar p
UNION ALL
 SELECT r.id, r.company_id, 'receber'::text AS tipo, r.descricao,
    r.cliente_nome AS contraparte_nome, r.cliente_id AS contraparte_id, r.categoria,
    r.valor, r.valor_pago, r.data_emissao, r.data_vencimento, r.data_pagamento, r.data_previsao,
    r.status, r.numero_documento, r.numero_nf, r.linha_negocio, r.created_at, r.updated_at,
    CASE
      WHEN r.status::text = 'pago'::text THEN 'pago'::text
      WHEN r.status::text = 'cancelado'::text THEN 'cancelado'::text
      WHEN r.status::text = 'incluido_remessa'::text THEN 'incluido_remessa'::text
      WHEN r.status::text = 'agendado'::text THEN 'agendado'::text
      WHEN r.data_vencimento < CURRENT_DATE THEN 'vencido'::text
      WHEN r.data_previsao IS NOT NULL AND r.status::text = 'aberto'::text THEN 'agendado'::text
      ELSE 'aberto'::text
    END AS status_calculado
   FROM erp_receber r;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) De-para de ocorrência (configurável, não hardcode) + seed Sicredi 748
--    Default seguro: código NÃO mapeado é tratado como REJEITAR (reverte + mostra o código cru pra
--    a Jordana decodificar) — nunca liquidar por engano.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_remessa_ocorrencia_mapa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco_codigo text NOT NULL DEFAULT '748',
  codigo text NOT NULL,
  efeito text NOT NULL CHECK (efeito IN ('agendar','liquidar','rejeitar','confirmar')),
  descricao text,
  UNIQUE (banco_codigo, codigo)
);
ALTER TABLE public.erp_remessa_ocorrencia_mapa ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='erp_remessa_ocorrencia_mapa' AND policyname='p_mapa_sel') THEN
    CREATE POLICY p_mapa_sel ON public.erp_remessa_ocorrencia_mapa FOR SELECT TO authenticated USING (true);
  END IF;
END $mig$;
GRANT SELECT ON public.erp_remessa_ocorrencia_mapa TO authenticated;

-- Seed Sicredi 748. BD/02=agendar · 00/000=liquidar · 03/26/30/AJ/HF/BF=rejeitar.
-- ⚠️ As DESCRIÇÕES dos códigos de rejeição são aproximadas — confirmar com o 1º .RET de rejeição real
-- da Jordana (Pendência de dado do SPEC). A SEGURANÇA não depende da descrição: não-mapeado = rejeitar.
INSERT INTO public.erp_remessa_ocorrencia_mapa (banco_codigo, codigo, efeito, descricao) VALUES
 ('748','BD','agendar','Título incluído/agendado para liquidação futura'),
 ('748','02','agendar','Agendamento confirmado pelo banco'),
 ('748','00','liquidar','Liquidação/pagamento efetivado'),
 ('748','000','liquidar','Liquidação/pagamento efetivado'),
 ('748','03','rejeitar','Rejeição (ex.: saldo insuficiente) — confirmar descrição com retorno real'),
 ('748','26','rejeitar','Rejeição — confirmar descrição com retorno real'),
 ('748','30','rejeitar','Rejeição — confirmar descrição com retorno real'),
 ('748','AJ','rejeitar','Rejeição/ajuste — confirmar descrição com retorno real'),
 ('748','HF','rejeitar','Rejeição — confirmar descrição com retorno real'),
 ('748','BF','rejeitar','Rejeição — confirmar descrição com retorno real')
ON CONFLICT (banco_codigo, codigo) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Marcar títulos como INCLUIDO_NA_REMESSA (guarda o status anterior). Chamado no gerar().
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remessa_marcar_incluidos(p_ids uuid[], p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_n int;
BEGIN
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'sem_acesso');
  END IF;
  UPDATE public.erp_pagar
     SET status_pre_remessa = status, status = 'incluido_remessa'
   WHERE id = ANY(p_ids) AND company_id = p_company_id
     AND status NOT IN ('pago','cancelado','incluido_remessa','agendado');  -- idempotente; não mexe em quitado
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('sucesso', true, 'marcados', v_n);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_remessa_marcar_incluidos(uuid[], uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Motor do retorno: aplica o EFEITO por ocorrência (de-para), com salvaguarda anti-baixa-cega.
--    agendar → status='agendado' (não baixa) · liquidar → baixa (só com data/valor do banco) ·
--    rejeitar/não-mapeado → reverte pro status_pre_remessa + grava motivo. Prévia e idempotência mantidas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_remessa_retorno_conciliar_auto(p_company_id uuid, p_itens jsonb, p_confirmar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_el jsonb; v_item RECORD;
  v_barra text; v_chave text; v_doc text;
  v_val_tit numeric; v_val_pago numeric; v_dt date; v_ocorr text; v_hint boolean;
  v_codmov text; v_occ text; v_banco text;
  v_efeito text; v_efdesc text;
  v_resultado text; v_motivo text; v_baixa jsonb;
  v_matched uuid[] := '{}';
  v_casados jsonb := '[]'::jsonb;
  v_agendados jsonb := '[]'::jsonb;
  v_naocasados jsonb := '[]'::jsonb;
  v_rejeitados jsonb := '[]'::jsonb;
  v_japagos jsonb := '[]'::jsonb;
  v_total int:=0; v_pagos int:=0; v_agen int:=0; v_rej int:=0; v_ja int:=0; v_err int:=0; v_nc int:=0;
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

    -- idempotência: já baixado, não reprocessa
    IF v_item.status_item = 'pago' OR v_item.pstatus = 'pago' THEN
      v_ja := v_ja + 1;
      v_japagos := v_japagos || jsonb_build_object('item_id', v_item.item_id, 'remessa', v_item.numero_sequencial,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'motivo', 'título já baixado');
      CONTINUE;
    END IF;

    -- DE-PARA: efeito por ocorrência. Casa por cod_movimento (BD/AJ/HF/BF...) OU pelos códigos de 2 díg
    -- do campo de ocorrências (00/03/26...). Prioridade: rejeitar > agendar > liquidar > confirmar.
    v_efeito := NULL; v_efdesc := NULL;
    SELECT m.efeito, m.descricao INTO v_efeito, v_efdesc
    FROM erp_remessa_ocorrencia_mapa m
    WHERE m.banco_codigo = v_banco
      AND ( m.codigo = v_codmov
         OR (v_occ <> '' AND m.codigo = ANY (
               SELECT substr(v_occ, g, 2) FROM generate_series(1, GREATEST(length(v_occ)-1, 1), 2) AS g)) )
    ORDER BY CASE m.efeito WHEN 'rejeitar' THEN 0 WHEN 'agendar' THEN 1 WHEN 'liquidar' THEN 2 ELSE 3 END
    LIMIT 1;
    IF v_efeito IS NULL THEN
      v_efeito := 'rejeitar'; v_efdesc := 'ocorrência não mapeada';   -- default seguro
    END IF;
    -- salvaguarda: liquidar SEM data/valor confirmados pelo banco NÃO baixa (nunca baixa cego)
    IF v_efeito = 'liquidar' AND (NOT v_hint OR v_val_pago <= 0 OR v_dt IS NULL) THEN
      v_efeito := 'rejeitar';
      v_efdesc := COALESCE(NULLIF(v_efdesc,'')||' · ','') || 'liquidação sem data/valor do banco';
    END IF;

    IF v_efeito = 'liquidar' THEN
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
      -- ACK/confirmação de recebimento da remessa: sem mudança de status, só registra a ocorrência
      IF p_confirmar THEN
        UPDATE erp_remessa_pagamento_item SET ocorrencia_retorno=v_ocorr WHERE id=v_item.item_id;
      END IF;
      v_agendados := v_agendados || jsonb_build_object(
        'item_id', v_item.item_id, 'remessa', v_item.numero_sequencial, 'pagar_id', v_item.erp_pagar_id,
        'descricao', v_item.descricao, 'valor', v_item.item_valor, 'ocorrencia', v_ocorr,
        'motivo', 'confirmação de recebimento (sem baixa)');

    ELSE  -- rejeitar (mapeado OU não-mapeado): reverte pro status pré-remessa + motivo visível
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
    'rejeitados', v_rejeitados, 'ja_pagos', v_japagos,
    'qtd_casados', jsonb_array_length(v_casados), 'qtd_agendados', jsonb_array_length(v_agendados),
    'qtd_nao_casados', jsonb_array_length(v_naocasados),
    'resumo', jsonb_build_object('total', v_total, 'pagos', v_pagos, 'agendados', v_agen, 'rejeitados', v_rej,
              'ja_pagos', v_ja, 'erros', v_err, 'nao_casados', v_nc));
END $function$;
