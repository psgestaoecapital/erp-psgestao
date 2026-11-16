-- GE · Comissões recorrentes de vendas (code-desenvolvedor-3 · piloto PS Gestão + PS Consultoria, genérico p/ qualquer empresa)
--
-- O que faz: o vendedor ligado a um contrato recebe uma % (ou valor fixo) TODA VEZ que o cliente paga. A baixa do recebível
-- (erp_receber) dispara a geração de UMA conta a pagar (erp_pagar) PENDENTE para o vendedor (fornecedor) — nunca paga
-- sozinha: o pagamento ao vendedor (PIX/remessa) continua sendo ação humana no contas a pagar.
--
-- Fronteira [→GE]: reusa erp_contratos (contrato/pacote), erp_receber (gatilho), erp_pagar (saída) e erp_fornecedores
-- (vendedor). As peças novas são ADITIVAS (RD-55/RD-97): 3 tabelas próprias, funções novas e um gatilho novo em
-- erp_receber que só LÊ o recebível e grava nas tabelas novas + erp_pagar (INSERT do título / cancelamento no estorno).
--
-- Por que gatilho e não hook numa RPC: a baixa de erp_receber tem vários caminhos (fn_receber_baixar_pagamento,
-- fn_receber_registrar_recebimento, batch_baixa_titulos, fn_baixar_pagamento_em_massa, conciliação, retorno CNAB,
-- razão erp_receber_baixa via recompute). Todos terminam mudando erp_receber.valor_pago/status, então o gatilho AFTER
-- UPDATE é o único ponto que cobre todos. O gatilho NUNCA derruba a baixa: erro vira evento 'erro' visível na tela.
--
-- Idempotência e pagamento parcial: a comissão-alvo de cada (regra, recebível) = % × valor_pago ATUAL (ou fixo
-- proporcional ao recebido). Já gerado = soma dos lançamentos 'gerada'. Só a diferença vira lançamento novo; rodar a
-- mesma baixa 2× dá diferença 0 → nada. Cada lançamento guarda o valor_pago acumulado que o originou e o índice único
-- (regra_id, recebivel_id, valor_pago_acumulado) WHERE status='gerada' trava duplicidade no banco. (O UNIQUE (regra,
-- recebivel) da especificação não permitiria a 2ª parcela de um pagamento parcial; este mantém a mesma garantia.)
-- Estorno/cancelamento do recebível (valor_pago cai ou status 'cancelado'/excluído) → lançamentos mais recentes viram
-- 'estornada' e o erp_pagar correspondente é CANCELADO (soft, com observação) se ainda não foi pago; se já foi pago ou
-- está em remessa, o lançamento fica estornado com PENDÊNCIA explícita (compensar manualmente) — nunca some.

-- ───────────────────────────── 1) Regra por venda ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_comissao_recorrente_regra (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id),
  contrato_id      uuid NOT NULL REFERENCES public.erp_contratos(id),
  fornecedor_id    uuid NOT NULL REFERENCES public.erp_fornecedores(id),
  tipo_comissao    text NOT NULL DEFAULT 'percentual' CHECK (tipo_comissao IN ('percentual','fixo')),
  percentual       numeric(5,2) NULL,
  valor_fixo       numeric(14,2) NULL,
  base             text NOT NULL DEFAULT 'valor_pago' CHECK (base = 'valor_pago'),
  vertical         text NULL,
  dias_vencimento  integer NOT NULL DEFAULT 7 CHECK (dias_vencimento BETWEEN 0 AND 120),
  vigencia_inicio  date NOT NULL DEFAULT current_date,
  vigencia_fim     date NULL,
  ativo            boolean NOT NULL DEFAULT true,
  observacao       text NULL,
  created_by       uuid NULL DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz NULL,
  deleted_by       uuid NULL,
  motivo_exclusao  text NULL,
  CONSTRAINT erp_comissao_recorrente_regra_valor_chk CHECK (
    (tipo_comissao = 'percentual' AND percentual > 0 AND percentual <= 100)
    OR (tipo_comissao = 'fixo' AND valor_fixo > 0)),
  CONSTRAINT erp_comissao_recorrente_regra_vigencia_chk CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
COMMENT ON TABLE public.erp_comissao_recorrente_regra IS
  'GE · Comissões recorrentes: regra (contrato × vendedor). Cada pagamento do cliente no contrato gera comissão ao vendedor. Soft-delete (RD-98).';
CREATE UNIQUE INDEX IF NOT EXISTS ux_comissao_rec_regra_contrato_vendedor
  ON public.erp_comissao_recorrente_regra (contrato_id, fornecedor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_comissao_rec_regra_company ON public.erp_comissao_recorrente_regra (company_id);
CREATE INDEX IF NOT EXISTS ix_comissao_rec_regra_contrato ON public.erp_comissao_recorrente_regra (contrato_id);

-- ───────────────────────────── 2) Livro de lançamentos ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_comissao_recorrente_lancamento (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id),
  regra_id              uuid NOT NULL REFERENCES public.erp_comissao_recorrente_regra(id),
  contrato_id           uuid NOT NULL REFERENCES public.erp_contratos(id),
  fornecedor_id         uuid NOT NULL REFERENCES public.erp_fornecedores(id),
  recebivel_id          uuid NOT NULL REFERENCES public.erp_receber(id),
  competencia           date NULL,
  valor_base            numeric(14,2) NOT NULL DEFAULT 0,
  valor_pago_acumulado  numeric(14,2) NOT NULL DEFAULT 0,
  percentual_aplicado   numeric(5,2) NULL,
  valor_fixo_aplicado   numeric(14,2) NULL,
  valor_comissao        numeric(14,2) NOT NULL,
  pagar_id              uuid NULL REFERENCES public.erp_pagar(id),
  status                text NOT NULL DEFAULT 'gerada' CHECK (status IN ('gerada','estornada')),
  origem                text NOT NULL DEFAULT 'baixa' CHECK (origem IN ('baixa','manual','reprocessamento')),
  estornado_em          timestamptz NULL,
  estornado_motivo      text NULL,
  pendencia             text NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_comissao_recorrente_lancamento IS
  'GE · Comissões recorrentes: livro. Cada pagamento do cliente que gerou comissão vira 1 linha ligada ao recebível (origem) e à conta a pagar criada (saída).';
CREATE UNIQUE INDEX IF NOT EXISTS ux_comissao_rec_lanc_idempotente
  ON public.erp_comissao_recorrente_lancamento (regra_id, recebivel_id, valor_pago_acumulado) WHERE status = 'gerada';
CREATE INDEX IF NOT EXISTS ix_comissao_rec_lanc_company_comp ON public.erp_comissao_recorrente_lancamento (company_id, competencia);
CREATE INDEX IF NOT EXISTS ix_comissao_rec_lanc_recebivel ON public.erp_comissao_recorrente_lancamento (recebivel_id);
CREATE INDEX IF NOT EXISTS ix_comissao_rec_lanc_pagar ON public.erp_comissao_recorrente_lancamento (pagar_id);

-- ───────────────────────────── 3) Esteira (eventos) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_comissao_recorrente_evento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  contrato_id    uuid NULL,
  recebivel_id   uuid NULL,
  regra_id       uuid NULL,
  lancamento_id  uuid NULL,
  pagar_id       uuid NULL,
  tipo           text NOT NULL CHECK (tipo IN ('identificado','gerada','estornada','sem_comissao','erro')),
  mensagem       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_comissao_recorrente_evento IS
  'GE · Comissões recorrentes: esteira por contrato (cliente pagou → sistema identificou → gerou conta a pagar), estornos, motivos de não comissionar e erros do gatilho.';
CREATE INDEX IF NOT EXISTS ix_comissao_rec_evento_contrato ON public.erp_comissao_recorrente_evento (company_id, contrato_id, created_at DESC);

-- ───────────────────────────── RLS: leitura por empresa; escrita só pelas RPCs ─────────────────────────────
ALTER TABLE public.erp_comissao_recorrente_regra      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_comissao_recorrente_lancamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_comissao_recorrente_evento     ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='erp_comissao_recorrente_regra' AND policyname='comissao_rec_regra_sel') THEN
    CREATE POLICY comissao_rec_regra_sel ON public.erp_comissao_recorrente_regra FOR SELECT TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='erp_comissao_recorrente_lancamento' AND policyname='comissao_rec_lanc_sel') THEN
    CREATE POLICY comissao_rec_lanc_sel ON public.erp_comissao_recorrente_lancamento FOR SELECT TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='erp_comissao_recorrente_evento' AND policyname='comissao_rec_evento_sel') THEN
    CREATE POLICY comissao_rec_evento_sel ON public.erp_comissao_recorrente_evento FOR SELECT TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()));
  END IF;
END $$;

REVOKE ALL ON public.erp_comissao_recorrente_regra, public.erp_comissao_recorrente_lancamento, public.erp_comissao_recorrente_evento FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_comissao_recorrente_regra, public.erp_comissao_recorrente_lancamento, public.erp_comissao_recorrente_evento FROM authenticated;
GRANT SELECT ON public.erp_comissao_recorrente_regra, public.erp_comissao_recorrente_lancamento, public.erp_comissao_recorrente_evento TO authenticated;

-- ───────────────────────────── Núcleo: sincroniza as comissões de UM recebível ─────────────────────────────
-- R$ no formato brasileiro, independente do lc_numeric do servidor (só formatação de texto da esteira)
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente__brl(p_valor numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  SELECT 'R$ ' || translate(to_char(coalesce(p_valor, 0), 'FM999,999,999,990.00'), ',.', '.,')
$fn$;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente__brl(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente__brl(numeric) TO authenticated;
-- ci-sem-guarda: fn_comissao_recorrente__sincronizar — interna, chamada só pelo gatilho de erp_receber e pelas RPCs com guarda (EXECUTE revogado de anon/authenticated/PUBLIC); a empresa vem do próprio recebível e toda regra/contrato/fornecedor é filtrada por ela.
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente__sincronizar(p_recebivel_id uuid, p_origem text DEFAULT 'baixa')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record; c record; g record; l record; f record; p record;
  v_vivo boolean; v_base numeric; v_aplica boolean; v_motivo text;
  v_ja numeric; v_ult numeric; v_alvo numeric; v_delta numeric;
  v_lanc uuid; v_pagar uuid; v_venc date; v_doc text; v_desc text; v_prev text; v_pend text;
  v_geradas int := 0; v_estornadas int := 0; v_valor_gerado numeric := 0;
BEGIN
  SELECT * INTO r FROM public.erp_receber WHERE id = p_recebivel_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'recebivel_nao_encontrado'); END IF;

  -- saída rápida: sem contrato e sem histórico, ou contrato sem regra e sem histórico
  IF NOT EXISTS (SELECT 1 FROM public.erp_comissao_recorrente_lancamento WHERE recebivel_id = r.id)
     AND (r.contrato_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.erp_comissao_recorrente_regra WHERE contrato_id = r.contrato_id AND company_id = r.company_id)) THEN
    RETURN jsonb_build_object('ok', true, 'motivo', CASE WHEN r.contrato_id IS NULL THEN 'sem_contrato' ELSE 'sem_regra' END);
  END IF;

  -- uma sincronização por recebível de cada vez (duas baixas simultâneas não geram em dobro)
  PERFORM pg_advisory_xact_lock(hashtextextended('comissao_recorrente:' || r.id::text, 0));
  SELECT * INTO r FROM public.erp_receber WHERE id = p_recebivel_id;

  SELECT * INTO c FROM public.erp_contratos WHERE id = r.contrato_id AND company_id = r.company_id;
  v_vivo := r.deleted_at IS NULL AND lower(coalesce(r.status, '')) <> 'cancelado';
  v_base := CASE WHEN v_vivo THEN greatest(coalesce(r.valor_pago, 0), 0) ELSE 0 END;

  FOR g IN
    SELECT * FROM public.erp_comissao_recorrente_regra x
     WHERE x.company_id = r.company_id
       AND ((x.contrato_id = r.contrato_id AND x.deleted_at IS NULL)
            OR x.id IN (SELECT regra_id FROM public.erp_comissao_recorrente_lancamento
                         WHERE recebivel_id = r.id AND status = 'gerada'))
     ORDER BY x.created_at
  LOOP
    SELECT coalesce(sum(valor_comissao), 0), max(valor_pago_acumulado) INTO v_ja, v_ult
      FROM public.erp_comissao_recorrente_lancamento
     WHERE regra_id = g.id AND recebivel_id = r.id AND status = 'gerada';

    -- a regra vale para ESTE pagamento?
    v_motivo := NULL;
    IF g.deleted_at IS NOT NULL OR NOT g.ativo THEN v_motivo := 'regra inativa ou excluída';
    ELSIF g.contrato_id IS DISTINCT FROM r.contrato_id THEN v_motivo := 'recebimento saiu do contrato';
    ELSIF r.data_pagamento IS NULL THEN v_motivo := 'recebimento sem data de pagamento';
    ELSIF r.data_pagamento < g.vigencia_inicio THEN v_motivo := 'pagamento antes do início da vigência (' || to_char(g.vigencia_inicio, 'DD/MM/YYYY') || ')';
    ELSIF g.vigencia_fim IS NOT NULL AND r.data_pagamento > g.vigencia_fim THEN v_motivo := 'pagamento depois do fim da vigência (' || to_char(g.vigencia_fim, 'DD/MM/YYYY') || ')';
    ELSIF c.id IS NULL OR c.excluido_em IS NOT NULL THEN v_motivo := 'contrato excluído';
    ELSIF NOT coalesce(CASE c.status
            WHEN 'ativo' THEN true
            WHEN 'suspenso' THEN r.data_pagamento < c.data_suspensao
            WHEN 'encerrado' THEN r.data_pagamento < c.data_encerramento
            ELSE false END, false) THEN
      v_motivo := 'contrato ' || coalesce(c.status, '?') || coalesce(' desde ' || to_char(coalesce(c.data_suspensao, c.data_encerramento), 'DD/MM/YYYY'), '');
    END IF;
    v_aplica := v_motivo IS NULL;

    IF v_base <= 0 THEN
      v_alvo := 0;
    ELSIF v_aplica THEN
      v_alvo := round(CASE WHEN g.tipo_comissao = 'percentual' THEN g.percentual / 100.0 * v_base
                           ELSE g.valor_fixo * coalesce(least(1, v_base / nullif(r.valor, 0)), 1) END, 2);
    ELSIF v_ja > 0 THEN
      -- regra deixou de valer depois de gerar: não gera mais, só reduz se o recebido cair
      v_alvo := round(v_ja * least(1, v_base / nullif(v_ult, 0)), 2);
    ELSE
      v_alvo := 0;
      IF g.deleted_at IS NULL AND g.ativo AND NOT EXISTS (
           SELECT 1 FROM public.erp_comissao_recorrente_evento e
            WHERE e.regra_id = g.id AND e.recebivel_id = r.id AND e.tipo = 'sem_comissao') THEN
        INSERT INTO public.erp_comissao_recorrente_evento (company_id, contrato_id, recebivel_id, regra_id, tipo, mensagem)
        VALUES (r.company_id, r.contrato_id, r.id, g.id, 'sem_comissao',
                'Cliente pagou ' || public.fn_comissao_recorrente__brl(v_base) || ' mas não gerou comissão para '
                || coalesce((SELECT coalesce(nullif(ff.nome_fantasia, ''), ff.razao_social) FROM public.erp_fornecedores ff WHERE ff.id = g.fornecedor_id), 'o vendedor')
                || ': ' || v_motivo || '.');
      END IF;
    END IF;

    -- ── estorno: recebido caiu (estorno/cancelamento) → desfaz do mais recente para o mais antigo
    IF v_alvo < v_ja - 0.009 THEN
      FOR l IN SELECT * FROM public.erp_comissao_recorrente_lancamento
                WHERE regra_id = g.id AND recebivel_id = r.id AND status = 'gerada'
                ORDER BY valor_pago_acumulado DESC, created_at DESC
      LOOP
        EXIT WHEN v_ja <= v_alvo + 0.009;
        v_pend := NULL;
        SELECT id, status, coalesce(valor_pago, 0) AS vp, deleted_at INTO p FROM public.erp_pagar WHERE id = l.pagar_id;
        IF p.id IS NULL OR p.deleted_at IS NOT NULL OR p.status = 'cancelado' THEN
          NULL;
        ELSIF p.vp = 0 AND p.status IN ('aberto', 'vencido') THEN
          UPDATE public.erp_pagar
             SET status = 'cancelado',
                 observacoes = concat_ws(E'\n', nullif(observacoes, ''),
                   'Cancelado automaticamente em ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
                   || ': o recebimento do cliente que gerou esta comissão foi estornado/cancelado (comissão recorrente).'),
                 updated_at = now()
           WHERE id = p.id;
        ELSE
          v_pend := 'Comissão já paga ou em remessa ao vendedor (status ' || p.status || '): compensar ou cobrar do vendedor manualmente.';
        END IF;
        UPDATE public.erp_comissao_recorrente_lancamento
           SET status = 'estornada', estornado_em = now(), pendencia = v_pend,
               estornado_motivo = CASE WHEN NOT v_vivo THEN 'recebimento cancelado/excluído'
                                       ELSE 'recebido do cliente caiu para ' || public.fn_comissao_recorrente__brl(v_base) END
         WHERE id = l.id;
        INSERT INTO public.erp_comissao_recorrente_evento (company_id, contrato_id, recebivel_id, regra_id, lancamento_id, pagar_id, tipo, mensagem)
        VALUES (r.company_id, l.contrato_id, r.id, g.id, l.id, l.pagar_id, 'estornada',
                'Recebimento estornado/cancelado → comissão de ' || public.fn_comissao_recorrente__brl(l.valor_comissao) || ' estornada'
                || CASE WHEN v_pend IS NULL THEN ' e conta a pagar cancelada.' ELSE '. ATENÇÃO: ' || v_pend END);
        v_ja := v_ja - l.valor_comissao;
        v_estornadas := v_estornadas + 1;
      END LOOP;
      SELECT max(valor_pago_acumulado) INTO v_ult FROM public.erp_comissao_recorrente_lancamento
       WHERE regra_id = g.id AND recebivel_id = r.id AND status = 'gerada';
    END IF;

    -- ── geração: só a diferença entre o devido e o já gerado (idempotente)
    IF v_alvo > v_ja + 0.009 THEN
      v_delta := round(v_alvo - v_ja, 2);
      IF EXISTS (SELECT 1 FROM public.erp_comissao_recorrente_lancamento
                  WHERE regra_id = g.id AND recebivel_id = r.id AND status = 'gerada' AND valor_pago_acumulado = v_base) THEN
        CONTINUE; -- mesmo recebido já comissionado (ex.: % mudou depois): não reabre
      END IF;
      SELECT * INTO f FROM public.erp_fornecedores WHERE id = g.fornecedor_id AND company_id = r.company_id;
      IF NOT FOUND THEN
        INSERT INTO public.erp_comissao_recorrente_evento (company_id, contrato_id, recebivel_id, regra_id, tipo, mensagem)
        VALUES (r.company_id, r.contrato_id, r.id, g.id, 'erro', 'Vendedor da regra não encontrado nesta empresa: comissão não gerada.');
        CONTINUE;
      END IF;

      v_lanc := gen_random_uuid();
      v_doc  := 'COMREC-' || upper(left(replace(v_lanc::text, '-', ''), 8));
      v_venc := greatest(r.data_pagamento, current_date) + g.dias_vencimento;
      v_desc := 'Comissão recorrente · ' || coalesce(nullif(f.nome_fantasia, ''), f.razao_social, 'vendedor')
                || ' · ' || coalesce(nullif(c.nome, ''), c.numero, 'contrato')
                || coalesce(' · ' || nullif(r.cliente_nome, ''), '');

      INSERT INTO public.erp_comissao_recorrente_evento (company_id, contrato_id, recebivel_id, regra_id, tipo, mensagem)
      VALUES (r.company_id, r.contrato_id, r.id, g.id, 'identificado',
              'Cliente pagou ' || public.fn_comissao_recorrente__brl(v_base - coalesce(v_ult, 0))
              || ' em ' || to_char(r.data_pagamento, 'DD/MM/YYYY') || coalesce(' (título ' || nullif(r.numero_documento, '') || ')', '')
              || ' → regra de ' || CASE WHEN g.tipo_comissao = 'percentual' THEN translate(to_char(g.percentual, 'FM990.00'), '.', ',') || '%'
                                      ELSE public.fn_comissao_recorrente__brl(g.valor_fixo) || ' fixo' END
              || ' para ' || coalesce(nullif(f.nome_fantasia, ''), f.razao_social, 'vendedor') || '.');

      -- a trava anti-duplicidade de títulos compara descrição+valor+vencimento; aqui o número COMREC é único por lançamento
      v_prev := current_setting('app.forcar_titulo_dup', true);
      PERFORM set_config('app.forcar_titulo_dup', '1', true);
      INSERT INTO public.erp_pagar (company_id, fornecedor_id, fornecedor_nome, descricao, categoria, valor,
                                    data_emissao, data_vencimento, data_competencia, status, forma_pagamento,
                                    chave_pix, numero_documento, contrato_id, observacoes)
      VALUES (r.company_id, f.id, coalesce(nullif(f.nome_fantasia, ''), f.razao_social), v_desc, 'Comissão recorrente', v_delta,
              current_date, v_venc, r.data_pagamento, 'aberto',
              CASE WHEN nullif(btrim(coalesce(f.pix, '')), '') IS NOT NULL THEN 'pix'
                   WHEN nullif(btrim(coalesce(f.conta, '')), '') IS NOT NULL THEN 'transferencia' END,
              nullif(btrim(coalesce(f.pix, '')), ''), v_doc, c.id,
              'Gerado automaticamente pela comissão recorrente: o cliente pagou ' || public.fn_comissao_recorrente__brl(v_base - coalesce(v_ult, 0))
              || ' em ' || to_char(r.data_pagamento, 'DD/MM/YYYY') || '. O pagamento ao vendedor é manual (nunca automático).')
      RETURNING id INTO v_pagar;
      PERFORM set_config('app.forcar_titulo_dup', coalesce(v_prev, ''), true);

      INSERT INTO public.erp_comissao_recorrente_lancamento (id, company_id, regra_id, contrato_id, fornecedor_id, recebivel_id,
          competencia, valor_base, valor_pago_acumulado, percentual_aplicado, valor_fixo_aplicado, valor_comissao, pagar_id, origem)
      VALUES (v_lanc, r.company_id, g.id, r.contrato_id, g.fornecedor_id, r.id,
              r.data_pagamento, round(v_base - coalesce(v_ult, 0), 2), v_base,
              CASE WHEN g.tipo_comissao = 'percentual' THEN g.percentual END,
              CASE WHEN g.tipo_comissao = 'fixo' THEN g.valor_fixo END,
              v_delta, v_pagar, coalesce(nullif(p_origem, ''), 'baixa'));

      INSERT INTO public.erp_comissao_recorrente_evento (company_id, contrato_id, recebivel_id, regra_id, lancamento_id, pagar_id, tipo, mensagem)
      VALUES (r.company_id, r.contrato_id, r.id, g.id, v_lanc, v_pagar, 'gerada',
              'Gerou conta a pagar ' || v_doc || ' de ' || public.fn_comissao_recorrente__brl(v_delta)
              || ' para ' || coalesce(nullif(f.nome_fantasia, ''), f.razao_social, 'vendedor')
              || ', vencimento ' || to_char(v_venc, 'DD/MM/YYYY') || ' (pendente de pagamento).');
      v_geradas := v_geradas + 1;
      v_valor_gerado := v_valor_gerado + v_delta;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'geradas', v_geradas, 'estornadas', v_estornadas, 'valor_gerado', v_valor_gerado);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente__sincronizar(uuid, text) FROM PUBLIC, anon, authenticated;

-- ───────────────────────────── Gatilho na baixa de erp_receber ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_comissao_recorrente_receber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.valor_pago IS NOT DISTINCT FROM OLD.valor_pago
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NEW.contrato_id IS NOT DISTINCT FROM OLD.contrato_id
     AND NEW.data_pagamento IS NOT DISTINCT FROM OLD.data_pagamento THEN
    RETURN NULL;
  END IF;
  IF NEW.contrato_id IS NULL AND (TG_OP = 'INSERT' OR OLD.contrato_id IS NULL) THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.fn_comissao_recorrente__sincronizar(NEW.id, 'baixa');
  EXCEPTION WHEN OTHERS THEN
    -- a baixa do cliente NUNCA cai por causa da comissão: o erro fica visível na esteira e no painel
    INSERT INTO public.erp_comissao_recorrente_evento (company_id, contrato_id, recebivel_id, tipo, mensagem)
    VALUES (NEW.company_id, coalesce(NEW.contrato_id, OLD.contrato_id), NEW.id, 'erro',
            'Falha ao gerar/estornar a comissão deste recebimento: ' || SQLERRM || '. Use "Reprocessar" no contrato.');
    RAISE WARNING 'comissao_recorrente: recebivel % — %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_trg_comissao_recorrente_receber() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_comissao_recorrente' AND tgrelid = 'public.erp_receber'::regclass) THEN
    CREATE TRIGGER trg_zz_comissao_recorrente
      AFTER INSERT OR UPDATE OF valor_pago, status, deleted_at, contrato_id, data_pagamento ON public.erp_receber
      FOR EACH ROW EXECUTE FUNCTION public.fn_trg_comissao_recorrente_receber();
  END IF;
END $$;

-- ───────────────────────────── RPCs da tela (todas com guarda de empresa) ─────────────────────────────

-- (re)processa a comissão de um recebível (a baixa já faz sozinha; isto é o botão manual / prova)
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_ao_receber(p_recebivel_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_receber WHERE id = p_recebivel_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'recebivel_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN public.fn_comissao_recorrente__sincronizar(p_recebivel_id, 'manual');
END $fn$;

-- estorna a comissão de um recebível que voltou (cancelado/estornado). Recebível ainda pago → orienta estornar a baixa.
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_estornar(p_recebivel_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r record;
BEGIN
  SELECT id, company_id, status, coalesce(valor_pago, 0) AS vp, deleted_at INTO r FROM public.erp_receber WHERE id = p_recebivel_id;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'recebivel_nao_encontrado'); END IF;
  IF NOT (r.company_id IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF r.deleted_at IS NULL AND r.status <> 'cancelado' AND r.vp > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'recebimento_ativo',
      'orientacao', 'O recebimento do cliente ainda consta como pago. Estorne a baixa (ou cancele o título) no Contas a receber: a comissão é estornada sozinha.');
  END IF;
  RETURN public.fn_comissao_recorrente__sincronizar(p_recebivel_id, 'manual');
END $fn$;

-- reprocessa todos os recebimentos de um contrato (ex.: regra cadastrada com vigência retroativa)
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_reprocessar_contrato(p_contrato_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_company uuid; v_id uuid; v_res jsonb; v_g int := 0; v_e int := 0; v_n int := 0;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_contratos WHERE id = p_contrato_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  FOR v_id IN
    SELECT id FROM public.erp_receber
     WHERE contrato_id = p_contrato_id AND company_id = v_company AND (coalesce(valor_pago, 0) > 0
        OR id IN (SELECT recebivel_id FROM public.erp_comissao_recorrente_lancamento WHERE contrato_id = p_contrato_id))
     ORDER BY data_pagamento NULLS LAST
     LIMIT 600
  LOOP
    v_res := public.fn_comissao_recorrente__sincronizar(v_id, 'reprocessamento');
    v_n := v_n + 1;
    v_g := v_g + coalesce((v_res->>'geradas')::int, 0);
    v_e := v_e + coalesce((v_res->>'estornadas')::int, 0);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'recebimentos', v_n, 'geradas', v_g, 'estornadas', v_e);
END $fn$;

-- incluir/editar regra (contrato + vendedor + % ou fixo)
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_regra_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid := nullif(p_dados->>'id', '')::uuid;
  v_contrato uuid := nullif(p_dados->>'contrato_id', '')::uuid;
  v_forn uuid := nullif(p_dados->>'fornecedor_id', '')::uuid;
  v_tipo text := coalesce(nullif(p_dados->>'tipo_comissao', ''), 'percentual');
  v_pct numeric := nullif(p_dados->>'percentual', '')::numeric;
  v_fixo numeric := nullif(p_dados->>'valor_fixo', '')::numeric;
  v_ini date := coalesce(nullif(p_dados->>'vigencia_inicio', '')::date, current_date);
  v_fim date := nullif(p_dados->>'vigencia_fim', '')::date;
  v_dias int := coalesce(nullif(p_dados->>'dias_vencimento', '')::int, 7);
  v_ativo boolean := coalesce((p_dados->>'ativo')::boolean, true);
  v_existe uuid;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_contratos WHERE id = v_contrato AND company_id = p_company_id AND excluido_em IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Escolha um contrato desta empresa.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_fornecedores WHERE id = v_forn AND company_id = p_company_id AND excluido_em IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Escolha o vendedor (cadastre na aba Vendedores se ainda não existe).');
  END IF;
  IF v_tipo NOT IN ('percentual', 'fixo') THEN RETURN jsonb_build_object('ok', false, 'erro', 'Tipo de comissão inválido.'); END IF;
  IF v_tipo = 'percentual' AND (v_pct IS NULL OR v_pct <= 0 OR v_pct > 100) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o percentual entre 0,01 e 100.');
  END IF;
  IF v_tipo = 'fixo' AND (v_fixo IS NULL OR v_fixo <= 0) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe o valor fixo por pagamento (maior que zero).');
  END IF;
  IF v_fim IS NOT NULL AND v_fim < v_ini THEN RETURN jsonb_build_object('ok', false, 'erro', 'O fim da vigência é antes do início.'); END IF;
  IF v_dias < 0 OR v_dias > 120 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Prazo para pagar o vendedor: de 0 a 120 dias.'); END IF;

  SELECT id INTO v_existe FROM public.erp_comissao_recorrente_regra
   WHERE contrato_id = v_contrato AND fornecedor_id = v_forn AND deleted_at IS NULL AND id IS DISTINCT FROM v_id;
  IF v_existe IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Este vendedor já tem regra neste contrato: edite a regra existente.');
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.erp_comissao_recorrente_regra (company_id, contrato_id, fornecedor_id, tipo_comissao, percentual, valor_fixo,
        vertical, dias_vencimento, vigencia_inicio, vigencia_fim, ativo, observacao, created_by)
    VALUES (p_company_id, v_contrato, v_forn, v_tipo, CASE WHEN v_tipo = 'percentual' THEN v_pct END,
            CASE WHEN v_tipo = 'fixo' THEN v_fixo END, nullif(btrim(p_dados->>'vertical'), ''), v_dias, v_ini, v_fim, v_ativo,
            nullif(btrim(p_dados->>'observacao'), ''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_comissao_recorrente_regra
       SET contrato_id = v_contrato, fornecedor_id = v_forn, tipo_comissao = v_tipo,
           percentual = CASE WHEN v_tipo = 'percentual' THEN v_pct END,
           valor_fixo = CASE WHEN v_tipo = 'fixo' THEN v_fixo END,
           vertical = nullif(btrim(p_dados->>'vertical'), ''), dias_vencimento = v_dias,
           vigencia_inicio = v_ini, vigencia_fim = v_fim, ativo = v_ativo,
           observacao = nullif(btrim(p_dados->>'observacao'), ''), updated_at = now()
     WHERE id = v_id AND company_id = p_company_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Regra não encontrada.'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;

-- excluir regra (soft, rastreável; comissões já geradas ficam no livro)
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_regra_excluir(p_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_comissao_recorrente_regra WHERE id = p_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Regra não encontrada.'); END IF;
  IF NOT (v_company IN (SELECT public.get_user_company_ids())) THEN RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso.'); END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da exclusão.'); END IF;
  UPDATE public.erp_comissao_recorrente_regra
     SET deleted_at = now(), deleted_by = auth.uid(), motivo_exclusao = btrim(p_motivo), ativo = false, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;

-- cadastro rápido do vendedor como fornecedor (reusa erp_fornecedores; incluir ou completar dados de pagamento)
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_vendedor_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid := nullif(p_dados->>'id', '')::uuid;
  v_nome text := nullif(btrim(p_dados->>'nome'), '');
  v_doc text := nullif(regexp_replace(coalesce(p_dados->>'cpf_cnpj', ''), '\D', '', 'g'), '');
  v_tp text := upper(coalesce(nullif(p_dados->>'tipo_pessoa', ''), CASE WHEN length(coalesce(v_doc, '')) = 11 THEN 'PF' ELSE 'PJ' END));
  v_dup uuid;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa.');
  END IF;
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o nome do vendedor.'); END IF;
  IF v_tp NOT IN ('PF', 'PJ') THEN RETURN jsonb_build_object('ok', false, 'erro', 'Tipo de pessoa: PF ou PJ.'); END IF;
  IF v_doc IS NOT NULL AND length(v_doc) NOT IN (11, 14) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'CPF tem 11 dígitos e CNPJ tem 14.');
  END IF;
  IF v_doc IS NOT NULL THEN
    SELECT id INTO v_dup FROM public.erp_fornecedores
     WHERE company_id = p_company_id AND excluido_em IS NULL AND id IS DISTINCT FROM v_id
       AND (regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = v_doc OR regexp_replace(coalesce(cnpj_cpf, ''), '\D', '', 'g') = v_doc)
     LIMIT 1;
    IF v_dup IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Já existe um fornecedor com este CPF/CNPJ: escolha-o na lista e edite.', 'id_existente', v_dup);
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.erp_fornecedores (company_id, nome_fantasia, razao_social, tipo_pessoa, cpf_cnpj, cnpj_cpf, telefone, celular,
        whatsapp, email, banco, agencia, conta, pix, categoria, ativo)
    VALUES (p_company_id, v_nome, coalesce(nullif(btrim(p_dados->>'razao_social'), ''), v_nome), v_tp, v_doc, v_doc,
            nullif(btrim(p_dados->>'telefone'), ''), nullif(btrim(p_dados->>'celular'), ''), nullif(btrim(p_dados->>'whatsapp'), ''),
            nullif(btrim(p_dados->>'email'), ''), nullif(btrim(p_dados->>'banco'), ''), nullif(btrim(p_dados->>'agencia'), ''),
            nullif(btrim(p_dados->>'conta'), ''), nullif(btrim(p_dados->>'pix'), ''), 'Vendedor', true)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_fornecedores
       SET nome_fantasia = v_nome, razao_social = coalesce(nullif(btrim(p_dados->>'razao_social'), ''), razao_social, v_nome),
           tipo_pessoa = v_tp, cpf_cnpj = coalesce(v_doc, cpf_cnpj), cnpj_cpf = coalesce(v_doc, cnpj_cpf),
           telefone = nullif(btrim(p_dados->>'telefone'), ''), celular = nullif(btrim(p_dados->>'celular'), ''),
           whatsapp = nullif(btrim(p_dados->>'whatsapp'), ''), email = nullif(btrim(p_dados->>'email'), ''),
           banco = nullif(btrim(p_dados->>'banco'), ''), agencia = nullif(btrim(p_dados->>'agencia'), ''),
           conta = nullif(btrim(p_dados->>'conta'), ''), pix = nullif(btrim(p_dados->>'pix'), ''), updated_at = now()
     WHERE id = v_id AND company_id = p_company_id AND excluido_em IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Vendedor não encontrado.'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $fn$;

-- painel: KPIs, por vertical, por vendedor (com projeção), alertas de corte
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_painel(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ini date := date_trunc('month', current_date)::date; v_fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date; v jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  WITH regras AS (
    SELECT g.*, c.nome AS contrato_nome, c.numero AS contrato_numero, c.cliente_nome, c.status AS contrato_status,
           c.data_suspensao, c.data_encerramento, c.data_fim,
           coalesce(c.valor_atual, c.valor_mensal, 0) AS valor_mensal,
           coalesce(nullif(btrim(g.vertical), ''), nullif(btrim(c.tipo), ''), 'Sem vertical') AS vert,
           coalesce(nullif(f.nome_fantasia, ''), f.razao_social, 'Vendedor') AS vendedor
      FROM public.erp_comissao_recorrente_regra g
      JOIN public.erp_contratos c ON c.id = g.contrato_id AND c.company_id = g.company_id
      JOIN public.erp_fornecedores f ON f.id = g.fornecedor_id
     WHERE g.company_id = p_company_id AND g.deleted_at IS NULL AND c.excluido_em IS NULL
  ), ativas AS (
    SELECT *, round(CASE WHEN tipo_comissao = 'percentual' THEN percentual / 100.0 * valor_mensal ELSE valor_fixo END, 2) AS prevista,
           CASE WHEN data_fim IS NULL THEN 12
                WHEN data_fim < current_date THEN 0 ELSE (extract(year FROM age(data_fim, current_date)) * 12 + extract(month FROM age(data_fim, current_date)))::int + 1 END AS meses_restantes
      FROM regras
     WHERE ativo AND contrato_status = 'ativo' AND vigencia_inicio <= v_fim AND (vigencia_fim IS NULL OR vigencia_fim >= current_date)
  ), lanc AS (
    SELECT l.*, coalesce(p.valor_pago, 0) AS pago_vendedor, p.data_pagamento AS pago_em, p.status AS pagar_status, p.data_vencimento AS pagar_venc
      FROM public.erp_comissao_recorrente_lancamento l
      LEFT JOIN public.erp_pagar p ON p.id = l.pagar_id
     WHERE l.company_id = p_company_id AND l.status = 'gerada'
  )
  SELECT jsonb_build_object(
    'ok', true,
    'mes', to_char(v_ini, 'YYYY-MM'),
    'kpis', jsonb_build_object(
      'mrr_com_comissao', (SELECT coalesce(sum(valor_mensal), 0) FROM (SELECT DISTINCT contrato_id, valor_mensal FROM ativas) x),
      'contratos_com_comissao', (SELECT count(DISTINCT contrato_id) FROM ativas),
      'comissao_prevista_mes', (SELECT coalesce(sum(prevista), 0) FROM ativas),
      'comissao_gerada_mes', (SELECT coalesce(sum(valor_comissao), 0) FROM lanc WHERE competencia BETWEEN v_ini AND v_fim),
      'comissao_paga_mes', (SELECT coalesce(sum(pago_vendedor), 0) FROM lanc WHERE pago_em BETWEEN v_ini AND v_fim),
      'comissao_a_pagar', (SELECT coalesce(sum(valor_comissao - pago_vendedor), 0) FROM lanc WHERE pagar_status IN ('aberto', 'vencido', 'parcial', 'agendado', 'incluido_remessa')),
      'comissao_vencida', (SELECT coalesce(sum(valor_comissao - pago_vendedor), 0) FROM lanc WHERE pagar_status IN ('vencido') OR (pagar_status IN ('aberto', 'parcial') AND pagar_venc < current_date)),
      'vendedores_ativos', (SELECT count(DISTINCT fornecedor_id) FROM ativas),
      'erros_7d', (SELECT count(*) FROM public.erp_comissao_recorrente_evento WHERE company_id = p_company_id AND tipo = 'erro' AND created_at > now() - interval '7 days'),
      'pendencias_estorno', (SELECT count(*) FROM public.erp_comissao_recorrente_lancamento WHERE company_id = p_company_id AND status = 'estornada' AND pendencia IS NOT NULL)
    ),
    'por_vertical', coalesce((SELECT jsonb_agg(x ORDER BY x.prevista DESC) FROM (
        SELECT a.vert AS vertical, count(DISTINCT a.contrato_id) AS contratos,
               (SELECT coalesce(sum(vm), 0) FROM (SELECT DISTINCT b.contrato_id, b.valor_mensal AS vm FROM ativas b WHERE b.vert = a.vert) y) AS mrr,
               sum(a.prevista) AS prevista,
               (SELECT coalesce(sum(l.valor_comissao), 0) FROM lanc l JOIN regras rr ON rr.id = l.regra_id
                 WHERE rr.vert = a.vert AND l.competencia BETWEEN v_ini AND v_fim) AS gerada_mes
          FROM ativas a GROUP BY a.vert) x), '[]'::jsonb),
    'por_vendedor', coalesce((SELECT jsonb_agg(x ORDER BY x.prevista DESC) FROM (
        SELECT v.fornecedor_id, v.vendedor, v.contratos, v.prevista, v.projecao,
               coalesce((SELECT sum(valor_comissao) FROM lanc l WHERE l.fornecedor_id = v.fornecedor_id AND l.competencia BETWEEN v_ini AND v_fim), 0) AS gerada_mes,
               coalesce((SELECT sum(pago_vendedor) FROM lanc l WHERE l.fornecedor_id = v.fornecedor_id AND l.pago_em BETWEEN v_ini AND v_fim), 0) AS paga_mes,
               coalesce((SELECT sum(valor_comissao) FROM lanc l WHERE l.fornecedor_id = v.fornecedor_id), 0) AS acumulado,
               coalesce((SELECT sum(valor_comissao - pago_vendedor) FROM lanc l WHERE l.fornecedor_id = v.fornecedor_id AND l.pagar_status IN ('aberto', 'vencido', 'parcial', 'agendado', 'incluido_remessa')), 0) AS a_pagar
          FROM (SELECT fornecedor_id, min(vendedor) AS vendedor, count(DISTINCT contrato_id) AS contratos, sum(prevista) AS prevista,
                       sum(prevista * meses_restantes) AS projecao
                  FROM ativas GROUP BY fornecedor_id) v) x), '[]'::jsonb),
    'alertas_corte', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'contrato_id', contrato_id, 'contrato', coalesce(nullif(contrato_nome, ''), contrato_numero), 'cliente', cliente_nome,
          'vendedor', vendedor, 'status', contrato_status, 'desde', coalesce(data_suspensao, data_encerramento)) ORDER BY coalesce(data_suspensao, data_encerramento) DESC NULLS LAST)
        FROM regras WHERE ativo AND contrato_status IN ('suspenso', 'encerrado')), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $fn$;

-- livro de comissões geradas (com nomes e situação do título a pagar)
CREATE OR REPLACE FUNCTION public.fn_comissao_recorrente_lancamentos(p_company_id uuid, p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_company_id IS NULL OR NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'regra_id', l.regra_id, 'contrato_id', l.contrato_id, 'fornecedor_id', l.fornecedor_id, 'recebivel_id', l.recebivel_id,
      'competencia', l.competencia, 'valor_base', l.valor_base, 'percentual_aplicado', l.percentual_aplicado,
      'valor_fixo_aplicado', l.valor_fixo_aplicado, 'valor_comissao', l.valor_comissao, 'status', l.status, 'origem', l.origem,
      'estornado_em', l.estornado_em, 'estornado_motivo', l.estornado_motivo, 'pendencia', l.pendencia, 'created_at', l.created_at,
      'pagar_id', l.pagar_id, 'pagar_documento', p.numero_documento, 'pagar_status', p.status, 'pagar_vencimento', p.data_vencimento,
      'pagar_valor_pago', coalesce(p.valor_pago, 0),
      'vendedor', coalesce(nullif(f.nome_fantasia, ''), f.razao_social),
      'contrato', coalesce(nullif(c.nome, ''), c.numero), 'cliente', coalesce(nullif(r.cliente_nome, ''), c.cliente_nome),
      'recebivel_documento', r.numero_documento, 'recebivel_descricao', r.descricao) ORDER BY l.competencia DESC NULLS LAST, l.created_at DESC)
    FROM public.erp_comissao_recorrente_lancamento l
    LEFT JOIN public.erp_pagar p ON p.id = l.pagar_id
    LEFT JOIN public.erp_fornecedores f ON f.id = l.fornecedor_id
    LEFT JOIN public.erp_contratos c ON c.id = l.contrato_id
    LEFT JOIN public.erp_receber r ON r.id = l.recebivel_id
   WHERE l.company_id = p_company_id
     AND (p_de IS NULL OR l.competencia >= p_de) AND (p_ate IS NULL OR l.competencia <= p_ate)), '[]'::jsonb);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_ao_receber(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_estornar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_reprocessar_contrato(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_regra_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_regra_excluir(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_vendedor_salvar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_painel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_comissao_recorrente_lancamentos(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_ao_receber(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_estornar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_reprocessar_contrato(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_regra_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_regra_excluir(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_vendedor_salvar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_painel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_comissao_recorrente_lancamentos(uuid, date, date) TO authenticated;

-- ───────────────────────────── Menu, catálogo de telas (RD-98 origem documentada) ─────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared, surface_in_groups, diferencial, descricao)
VALUES ('ge_comissoes_recorrentes', 'Comissões recorrentes', 'gestao_empresarial', 'contratos_vendas',
        '/dashboard/gestao-empresarial/comissoes-recorrentes', 'Percent', 5, true, false, true, ARRAY['gestao_empresarial']::text[], true,
        'O vendedor recebe uma % (ou valor fixo) toda vez que o cliente do contrato paga: a conta a pagar do vendedor nasce sozinha, pendente de pagamento.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.plan_modules (plan_id, module_id, is_default_active)
SELECT DISTINCT pm.plan_id, 'ge_comissoes_recorrentes', true
  FROM public.plan_modules pm
 WHERE pm.module_id = 'ge_cadastros_contratos_recorrentes'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'ge_comissoes_recorrentes');

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento, rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('ge_comissoes_recorrentes', '/dashboard/gestao-empresarial/comissoes-recorrentes', 'gestao_empresarial', 'ge_comissoes_recorrentes',
  'Comissões recorrentes',
  'Regras de comissão por contrato (vendedor, % ou valor fixo, vigência). Origem do dado: erp_contratos (contrato/pacote), erp_receber (pagamento do cliente = gatilho trg_zz_comissao_recorrente), erp_pagar (conta a pagar gerada, sempre pendente) e erp_fornecedores (vendedor). Livro em erp_comissao_recorrente_lancamento, esteira em erp_comissao_recorrente_evento, exclusão de regra com motivo (soft-delete).',
  'parcial', 'alta',
  ARRAY['fn_comissao_recorrente_painel','fn_comissao_recorrente_lancamentos','fn_comissao_recorrente_regra_salvar','fn_comissao_recorrente_regra_excluir','fn_comissao_recorrente_vendedor_salvar','fn_comissao_recorrente_reprocessar_contrato','fn_comissao_recorrente_ao_receber','fn_comissao_recorrente_estornar']::text[],
  ARRAY['ComissoesRecorrentesPage']::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

-- ───────────────────────────── RD-95: "?" de todo campo, filtro, indicador e ação ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Comissões recorrentes', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/gestao-empresarial/comissoes-recorrentes', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('comrec.abas', 'Abas da tela', 'Escolha a aba: Painel, Contratos e comissões, Comissões geradas ou Vendedores.', 'Separa a visão geral, o cadastro das regras, o histórico do que foi gerado e o cadastro dos vendedores.', 'Comece por Vendedores, depois Contratos e comissões.', 'Procurar o histórico na aba Contratos: ele fica em Comissões geradas.', 1),
 ('comrec.kpi_mrr', 'Receita mensal com comissão', 'Valor calculado.', 'Soma do valor mensal dos contratos ativos que têm pelo menos uma regra de comissão ativa.', '3 contratos de R$ 2.000 = R$ 6.000.', 'Achar que soma todos os contratos: só os que têm vendedor com regra.', 2),
 ('comrec.kpi_prevista', 'Comissão prevista no mês', 'Valor calculado.', 'Quanto os vendedores devem receber por mês se todos os clientes pagarem: % × valor mensal (ou o valor fixo).', '10% de R$ 6.000 = R$ 600.', 'Comparar com o gerado no dia 5: a comissão só nasce quando o cliente paga.', 3),
 ('comrec.kpi_gerada', 'Comissão gerada no mês', 'Valor calculado.', 'Comissões que já viraram conta a pagar neste mês, pelos pagamentos que os clientes fizeram.', 'Cliente pagou R$ 2.000 → R$ 200 gerados.', 'Achar que gerado é pago: gerado ainda espera o pagamento ao vendedor.', 4),
 ('comrec.kpi_paga', 'Comissão paga no mês', 'Valor calculado.', 'Quanto das contas de comissão já foi efetivamente pago aos vendedores neste mês.', 'R$ 150 de R$ 200 gerados já pagos.', 'Esperar que o sistema pague sozinho: o pagamento ao vendedor é sempre manual.', 5),
 ('comrec.kpi_vendedores', 'Vendedores ativos', 'Valor calculado.', 'Quantos vendedores têm regra ativa em contrato ativo.', '2 vendedores.', 'Contar vendedor de contrato encerrado: ele sai da conta.', 6),
 ('comrec.semaforo', 'Semáforo previsto × pago', 'Nada a preencher.', 'Verde: o pago acompanha o gerado e nada está vencido. Amarelo: há comissão gerada esperando pagamento. Vermelho: há comissão vencida sem pagar ou erro na geração.', 'R$ 50 vencidos → vermelho.', 'Ignorar o vermelho: o vendedor está esperando.', 7),
 ('comrec.por_vertical', 'Por vertical ou serviço', 'Nada a preencher: o agrupamento usa a vertical da regra (ou o tipo do contrato).', 'Mostra onde está a receita com comissão e quanto de comissão cada vertical gera.', 'BPO Financeiro: R$ 4.000 de receita, R$ 400 de comissão.', 'Deixar a vertical em branco: cai no tipo do contrato.', 8),
 ('comrec.por_vendedor', 'Por vendedor e projeção', 'Nada a preencher.', 'Quanto cada vendedor recebe por mês e quanto deve receber enquanto os contratos durarem (projeção: até o fim do contrato, ou 12 meses se não tem fim).', 'R$ 300/mês × 12 meses = R$ 3.600 de projeção.', 'Ler a projeção como garantida: ela depende de o cliente pagar.', 9),
 ('comrec.alertas', 'Contratos que pararam de comissionar', 'Nada a preencher.', 'Contrato suspenso ou encerrado para de gerar comissão na data da suspensão/encerramento, mesmo com a regra ativa.', 'Suspenso desde 10/11 → pagamento de 15/11 não comissiona.', 'Achar que é erro: reative o contrato para voltar a comissionar.', 10),
 ('comrec.simulador', 'Simulador "e se"', 'Informe quantos contratos novos, o valor mensal de cada um e a % de comissão.', 'Mostra quanto a comissão mensal e a do ano sobem se esses contratos forem fechados.', '5 contratos de R$ 1.500 a 10% = +R$ 750/mês.', 'Usar o valor anual do contrato no campo mensal.', 11),
 ('comrec.sim_qtd', 'Contratos novos', 'Número de contratos que você imagina fechar.', 'Multiplica o valor mensal e a comissão.', '5.', 'Colocar o número de parcelas.', 12),
 ('comrec.sim_valor', 'Valor mensal de cada contrato', 'Valor da mensalidade de um contrato.', 'Base da comissão simulada.', 'R$ 1.500.', 'Colocar o valor total do ano.', 13),
 ('comrec.sim_pct', '% de comissão simulada', 'A % que você pagaria ao vendedor.', 'Calcula a comissão de cada mensalidade.', '10.', 'Escrever 0,1 para 10%: escreva 10.', 14),
 ('comrec.busca_contrato', 'Buscar contrato', 'Digite parte do cliente, do contrato ou do vendedor.', 'Filtra a lista de contratos.', 'Acme.', 'Buscar pelo valor: busque pelo nome.', 15),
 ('comrec.filtro_contrato', 'Mostrar contratos', 'Escolha: com comissão, sem comissão ou todos.', 'Ajuda a achar contratos que ainda não têm vendedor ligado.', '"Sem comissão" para cadastrar as regras que faltam.', 'Esquecer o filtro em "com comissão" e não achar o contrato novo.', 16),
 ('comrec.contrato', 'Contrato', 'Escolha o contrato de receita (cliente + pacote) que o vendedor fechou.', 'Todo pagamento deste contrato gera a comissão.', 'Acme · BPO Financeiro · R$ 2.000/mês.', 'Escolher contrato de despesa: só contratos de receita aparecem.', 17),
 ('comrec.vendedor', 'Vendedor', 'Escolha o vendedor (cadastrado como fornecedor).', 'Recebe a conta a pagar de cada comissão.', 'Maria Souza (PF, PIX CPF).', 'Vendedor sem PIX/banco: a conta nasce sem dado de pagamento.', 18),
 ('comrec.tipo', 'Tipo de comissão', 'Percentual (sobre o que o cliente pagou) ou valor fixo por pagamento.', 'Define como o valor da comissão é calculado.', '10% ou R$ 150 por mensalidade paga.', 'Usar fixo e esperar que mude com reajuste: fixo não muda.', 19),
 ('comrec.percentual', 'Percentual', 'A % sobre o valor que o cliente efetivamente pagou (de 0,01 a 100).', 'Comissão = % × valor recebido. Pagamento parcial → comissão proporcional.', '10 → cliente pagou R$ 2.000, comissão R$ 200.', 'Calcular sobre o faturado: a base é sempre o recebido.', 20),
 ('comrec.valor_fixo', 'Valor fixo', 'Quanto o vendedor recebe por mensalidade paga.', 'Se o cliente pagar só parte, o fixo é proporcional ao que entrou.', 'R$ 150 por mês; pagou metade → R$ 75.', 'Informar o total do contrato em vez do valor por pagamento.', 21),
 ('comrec.vertical', 'Vertical ou serviço', 'Opcional: o nome do pacote/vertical para o painel.', 'Agrupa as comissões por vertical no painel. Em branco usa o tipo do contrato.', 'BPO Financeiro, Hub de Projetos.', 'Escrever cada vez de um jeito: o painel separa "BPO" de "Bpo".', 22),
 ('comrec.vigencia_inicio', 'Início da vigência', 'Data a partir da qual os pagamentos do cliente geram comissão.', 'Pagamento antes desta data não comissiona.', '01/11/2026.', 'Pôr a data da assinatura e esquecer pagamentos anteriores: use Reprocessar se a vigência for retroativa.', 23),
 ('comrec.vigencia_fim', 'Fim da vigência', 'Opcional: até quando o vendedor recebe. Em branco = enquanto o contrato durar.', 'Pagamento depois desta data não comissiona.', 'Em branco ou 31/12/2027.', 'Preencher a data do fim do contrato: deixe em branco, o contrato encerrado já corta.', 24),
 ('comrec.dias_vencimento', 'Prazo para pagar o vendedor', 'Quantos dias depois do pagamento do cliente a conta do vendedor vence (0 a 120).', 'Define o vencimento da conta a pagar gerada.', '7 dias: cliente pagou dia 10 → vence dia 17.', 'Pôr 0 e a conta já nascer vencida no dia seguinte.', 25),
 ('comrec.ativo', 'Regra ativa', 'Desmarque para pausar a comissão sem excluir a regra.', 'Regra pausada não gera comissão nos próximos pagamentos; o que já foi gerado fica.', 'Pausar durante uma disputa com o vendedor.', 'Excluir quando só queria pausar.', 26),
 ('comrec.observacao', 'Observação', 'Opcional: combinado com o vendedor.', 'Fica registrado na regra.', 'Comissão negociada na reunião de 05/11.', 'Pôr aqui a % em vez do campo próprio.', 27),
 ('comrec.reprocessar', 'Reprocessar pagamentos', 'Toque para recalcular as comissões dos pagamentos já recebidos deste contrato.', 'Gera o que faltou (ex.: vigência retroativa) e estorna o que voltou. Não duplica nada.', 'Regra criada hoje com início em 01/10 → reprocessar gera outubro.', 'Achar que duplica: o sistema só gera a diferença.', 28),
 ('comrec.esteira', 'Esteira do contrato', 'Nada a preencher.', 'Mostra, pagamento a pagamento: cliente pagou → sistema identificou → gerou a conta a pagar (ou por que não gerou).', '10/11: pagou R$ 2.000 → identificou 10% → gerou COMREC-1A2B de R$ 200.', 'Não olhar o motivo quando não gerou: ele diz o que ajustar.', 29),
 ('comrec.excluir_regra', 'Excluir regra', 'Informe o motivo e confirme.', 'A regra para de gerar comissão e fica registrada com quem excluiu e por quê. O que já foi gerado continua no livro.', 'Vendedor saiu da empresa.', 'Excluir para corrigir a %: edite a regra.', 30),
 ('comrec.motivo_exclusao', 'Motivo da exclusão', 'Escreva por que a regra está sendo excluída.', 'Fica no histórico (exclusão rastreável).', 'Contrato renegociado sem comissão.', 'Deixar em branco: não deixa excluir.', 31),
 ('comrec.f_vendedor', 'Filtro por vendedor', 'Escolha o vendedor.', 'Mostra só as comissões dele.', 'Maria Souza.', 'Esquecer o filtro ligado.', 32),
 ('comrec.f_contrato', 'Filtro por contrato', 'Escolha o contrato.', 'Mostra só as comissões daquele contrato.', 'Acme · BPO.', 'Esquecer o filtro ligado.', 33),
 ('comrec.f_competencia', 'Competência', 'Escolha o mês do pagamento do cliente.', 'A competência da comissão é a data em que o cliente pagou.', 'Novembro/2026.', 'Procurar pelo vencimento da conta do vendedor.', 34),
 ('comrec.f_status', 'Situação', 'Gerada ou estornada.', 'Estornada = o pagamento do cliente voltou e a comissão foi desfeita.', 'Estornadas com pendência = comissão já paga ao vendedor.', 'Ignorar pendência: é preciso compensar com o vendedor.', 35),
 ('comrec.livro', 'Comissões geradas', 'Nada a preencher.', 'Cada linha é um pagamento do cliente que gerou comissão, ligada à conta a pagar criada.', 'Pagou R$ 2.000 → R$ 200 → COMREC-1A2B (aberto).', 'Pagar o vendedor fora do sistema: dê baixa na conta COMREC.', 36),
 ('comrec.ver_pagar', 'Ver no contas a pagar', 'Toque para abrir a conta a pagar desta comissão.', 'Leva ao título no contas a pagar para pagar o vendedor (PIX/remessa).', 'COMREC-1A2B.', 'Procurar fora do período: ajuste o período no contas a pagar.', 37),
 ('comrec.v_nome', 'Nome do vendedor', 'Nome como o vendedor é conhecido.', 'Aparece nas regras e nas contas a pagar.', 'Maria Souza.', 'Cadastrar o mesmo vendedor duas vezes: procure antes na lista.', 38),
 ('comrec.v_tipo_pessoa', 'PF ou PJ', 'PF se recebe no CPF; PJ se emite nota pela empresa dele.', 'Define o documento esperado.', 'PJ para representante com CNPJ.', 'Marcar PF e digitar CNPJ.', 39),
 ('comrec.v_documento', 'CPF ou CNPJ', 'Só números ou com pontuação.', 'Evita vendedor duplicado e identifica o recebedor.', '123.456.789-09.', 'Digitar o CPF do cliente.', 40),
 ('comrec.v_contato', 'Telefone e WhatsApp', 'Telefone com DDD.', 'Contato para avisar do pagamento.', '(11) 99999-0000.', 'Esquecer o DDD.', 41),
 ('comrec.v_email', 'E-mail', 'E-mail do vendedor.', 'Contato e envio de comprovante.', 'maria@exemplo.com.', 'E-mail pessoal desatualizado.', 42),
 ('comrec.v_pix', 'Chave PIX', 'CPF, CNPJ, e-mail, telefone ou chave aleatória.', 'Vai pronta para a conta a pagar de cada comissão: é só pagar.', '123.456.789-09.', 'Chave de outra pessoa: o PIX cai na conta errada.', 43),
 ('comrec.v_banco', 'Banco, agência e conta', 'Para quem recebe por transferência.', 'Usado quando não há PIX.', 'Banco 001 · Ag 1234 · CC 12345-6.', 'Esquecer o dígito da conta.', 44),
 ('comrec.v_pronto', 'Pronto para pagar', 'Nada a preencher.', 'Verde quando o vendedor tem PIX ou conta bancária: a conta a pagar já nasce com o dado de pagamento.', 'PIX preenchido → pronto.', 'Gerar comissão para vendedor sem dado de pagamento.', 45)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
