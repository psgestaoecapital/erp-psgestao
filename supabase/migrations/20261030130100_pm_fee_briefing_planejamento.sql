-- P&M · Onda PM-F, PR F2 (CEO 28/10/2026 16:41, Documento Mestre P&M V30 §00-F):
-- "Fee → Briefing → Planejamento → Jobs: só depois do planejamento nascem os jobs, um por serviço".
--
-- 1) O briefing e o planejamento passam a ser DO FEE: agency_briefings.fee_id, agency_planejamentos.fee_id e
--    agency_planejamentos.briefing_id (opcionais; o que já existe continua igual). Vínculo validado: mesmo
--    fee/briefing da empresa e do cliente.
-- 2) O job que nasce do item aprovado do planejamento herda o fee (agency_jobs.contrato_id) e o briefing — é o que
--    alimenta o realizado × contratado do fee (fn_agency_contrato_realizado já conta jobs por contrato_id + serviço).
-- 3) fn_pm_planejamento_do_fee(fee, mês): cria o planejamento do mês do fee já com um item por serviço contratado
--    (quantidade do mês), datas distribuídas no mês, tudo em rascunho e editável. Idempotente por cliente/mês/campanha.
--
-- Aditiva: 3 colunas novas (anuláveis), 2 índices, funções e gatilhos NOVOS. Nenhuma função existente recriada,
-- nenhum dado de cliente alterado.

ALTER TABLE public.agency_briefings     ADD COLUMN IF NOT EXISTS fee_id uuid REFERENCES public.agency_contratos(id) ON DELETE SET NULL;
ALTER TABLE public.agency_planejamentos ADD COLUMN IF NOT EXISTS fee_id uuid REFERENCES public.agency_contratos(id) ON DELETE SET NULL;
ALTER TABLE public.agency_planejamentos ADD COLUMN IF NOT EXISTS briefing_id uuid REFERENCES public.agency_briefings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_agency_briefings_fee ON public.agency_briefings (fee_id) WHERE fee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_agency_planejamentos_fee ON public.agency_planejamentos (fee_id) WHERE fee_id IS NOT NULL;

-- ── 1. Vínculo com o fee: da mesma empresa e do mesmo cliente ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_agency_fee_vinculo_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
-- ci-sem-guarda: trg_agency_fee_vinculo_validar — gatilho da própria linha gravada; só confere o vínculo, não grava em outra tabela
DECLARE f agency_contratos%ROWTYPE; b agency_briefings%ROWTYPE;
BEGIN
  IF NEW.fee_id IS NOT NULL THEN
    SELECT * INTO f FROM agency_contratos WHERE id = NEW.fee_id;
    IF NOT FOUND OR f.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'Fee não encontrado nesta empresa.' USING ERRCODE = '23503';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'agency_briefings' THEN
    IF NEW.fee_id IS NOT NULL AND f.cliente_id IS NOT NULL AND NEW.cliente_id IS NOT NULL AND f.cliente_id <> NEW.cliente_id THEN
      RAISE EXCEPTION 'O fee escolhido é de outro cliente.' USING ERRCODE = '23514';
    END IF;
  ELSE -- agency_planejamentos (cliente = erp_clientes)
    IF NEW.fee_id IS NOT NULL AND f.erp_cliente_id IS NOT NULL AND f.erp_cliente_id <> NEW.cliente_id THEN
      RAISE EXCEPTION 'O fee escolhido é de outro cliente.' USING ERRCODE = '23514';
    END IF;
    IF NEW.briefing_id IS NOT NULL THEN
      SELECT * INTO b FROM agency_briefings WHERE id = NEW.briefing_id;
      IF NOT FOUND OR b.company_id <> NEW.company_id THEN
        RAISE EXCEPTION 'Briefing não encontrado nesta empresa.' USING ERRCODE = '23503';
      END IF;
      IF b.fee_id IS NOT NULL AND NEW.fee_id IS NOT NULL AND b.fee_id <> NEW.fee_id THEN
        RAISE EXCEPTION 'O briefing escolhido é de outro fee.' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_agency_briefing_fee_validar ON public.agency_briefings;
CREATE TRIGGER trg_agency_briefing_fee_validar
  BEFORE INSERT OR UPDATE OF fee_id, cliente_id ON public.agency_briefings
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_fee_vinculo_validar();
DROP TRIGGER IF EXISTS trg_agency_planejamento_fee_validar ON public.agency_planejamentos;
CREATE TRIGGER trg_agency_planejamento_fee_validar
  BEFORE INSERT OR UPDATE OF fee_id, briefing_id, cliente_id ON public.agency_planejamentos
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_fee_vinculo_validar();

-- ── 2. Job que nasce do planejamento herda o fee e o briefing ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_agency_post_job_herda_fee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
-- ci-sem-guarda: trg_agency_post_job_herda_fee — gatilho do próprio post gravado; só mexe no job ligado a ele, da mesma empresa
DECLARE p agency_planejamentos%ROWTYPE;
BEGIN
  SELECT * INTO p FROM agency_planejamentos WHERE id = NEW.planejamento_id AND company_id = NEW.company_id;
  IF NOT FOUND OR (p.fee_id IS NULL AND p.briefing_id IS NULL) THEN RETURN NULL; END IF;
  UPDATE agency_jobs
     SET contrato_id = COALESCE(contrato_id, p.fee_id),
         briefing_id = COALESCE(briefing_id, p.briefing_id),
         updated_at = now()
   WHERE id = NEW.job_id AND company_id = NEW.company_id
     AND (contrato_id IS NULL OR briefing_id IS NULL);
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_agency_post_job_herda_fee_ins ON public.agency_posts;
CREATE TRIGGER trg_agency_post_job_herda_fee_ins
  AFTER INSERT ON public.agency_posts
  FOR EACH ROW WHEN (NEW.job_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_agency_post_job_herda_fee();
DROP TRIGGER IF EXISTS trg_agency_post_job_herda_fee_upd ON public.agency_posts;
CREATE TRIGGER trg_agency_post_job_herda_fee_upd
  AFTER UPDATE ON public.agency_posts
  FOR EACH ROW WHEN (OLD.job_id IS NULL AND NEW.job_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_agency_post_job_herda_fee();

-- ── 3. Planejamento do mês nascido do fee ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_planejamento_do_fee(p_fee_id uuid, p_mes date, p_campanha text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  f agency_contratos%ROWTYPE; v_mes date := date_trunc('month', p_mes)::date; v_dias int;
  v_plan uuid; v_brief uuid; v_cli_nome text; v_existente agency_planejamentos%ROWTYPE;
  v_campanha text := NULLIF(btrim(COALESCE(p_campanha, '')), ''); it record; v_n int; k int; v_total int := 0; v_ordem int := 0;
  v_meses text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
BEGIN
  SELECT * INTO f FROM agency_contratos WHERE id = p_fee_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'fee_nao_encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(f.company_id);
  IF f.status <> 'ativo' THEN RETURN jsonb_build_object('ok', false, 'erro', 'fee_nao_ativo'); END IF;
  IF f.erp_cliente_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'fee_sem_cliente'); END IF;
  IF p_mes IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'mes_obrigatorio'); END IF;

  -- já existe planejamento deste cliente/mês/campanha → liga ao fee (se livre) e devolve, sem duplicar itens
  SELECT * INTO v_existente FROM agency_planejamentos
   WHERE company_id = f.company_id AND cliente_id = f.erp_cliente_id AND mes = v_mes
     AND lower(COALESCE(campanha, '')) = lower(COALESCE(v_campanha, '')) AND excluido_em IS NULL;
  IF FOUND THEN
    IF v_existente.fee_id IS NOT NULL AND v_existente.fee_id <> f.id THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'planejamento_de_outro_fee', 'planejamento_id', v_existente.id);
    END IF;
    IF v_existente.fee_id IS NULL THEN
      UPDATE agency_planejamentos SET fee_id = f.id WHERE id = v_existente.id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'planejamento_id', v_existente.id, 'ja_existia', true);
  END IF;

  SELECT id INTO v_brief FROM agency_briefings WHERE fee_id = f.id ORDER BY created_at DESC LIMIT 1;
  SELECT COALESCE(NULLIF(btrim(nome_fantasia), ''), razao_social) INTO v_cli_nome FROM erp_clientes WHERE id = f.erp_cliente_id;
  v_dias := extract(day FROM (v_mes + interval '1 month - 1 day'))::int;

  INSERT INTO agency_planejamentos (company_id, cliente_id, mes, campanha, titulo, status, responsavel_id, fee_id, briefing_id, observacoes)
  VALUES (f.company_id, f.erp_cliente_id, v_mes, v_campanha,
          format('%s — %s/%s', COALESCE(v_cli_nome, 'Cliente'), initcap(v_meses[extract(month FROM v_mes)::int]), extract(year FROM v_mes)::int),
          'rascunho', f.responsavel_id, f.id, v_brief, 'Gerado a partir do fee: um item por serviço contratado no mês. Ajuste datas e conteúdo antes de aprovar.')
  RETURNING id INTO v_plan;

  FOR it IN
    SELECT ci.servico_id, COALESCE(sv.nome, ci.tipo_servico) AS nome, COALESCE(ci.quantidade_contratada, 1) AS q,
           lower(COALESCE(ci.periodicidade, 'mensal')) AS per
      FROM agency_contrato_itens ci LEFT JOIN agency_servico sv ON sv.id = ci.servico_id AND sv.company_id = f.company_id
     WHERE ci.contrato_id = f.id ORDER BY ci.criado_em, ci.tipo_servico
  LOOP
    v_n := CASE
      WHEN it.per = 'semanal' THEN ceil(it.q * 4)::int
      WHEN it.per = 'quinzenal' THEN ceil(it.q * 2)::int
      WHEN it.per IN ('unica', 'projeto') THEN CASE WHEN date_trunc('month', COALESCE(f.data_inicio, v_mes)) = v_mes THEN ceil(it.q)::int ELSE 0 END
      ELSE ceil(it.q)::int END;
    v_n := LEAST(GREATEST(v_n, 0), 60);
    FOR k IN 1..v_n LOOP
      EXIT WHEN v_total >= 120;
      v_ordem := v_ordem + 1; v_total := v_total + 1;
      INSERT INTO agency_posts (company_id, planejamento_id, cliente_id, assunto, publicar_em, servico_id, status, ordem)
      VALUES (f.company_id, v_plan, f.erp_cliente_id,
              CASE WHEN v_n > 1 THEN format('%s %s/%s', it.nome, k, v_n) ELSE it.nome END,
              ((v_mes + LEAST(v_dias - 1, floor((k - 0.5) * v_dias / v_n)::int)) + time '10:00') AT TIME ZONE 'America/Sao_Paulo',
              it.servico_id, 'rascunho', v_ordem);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'planejamento_id', v_plan, 'ja_existia', false, 'itens', v_total, 'briefing_id', v_brief);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_pm_planejamento_do_fee(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_planejamento_do_fee(uuid, date, text) TO authenticated;
REVOKE ALL ON FUNCTION public.trg_agency_fee_vinculo_validar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_agency_post_job_herda_fee() FROM PUBLIC, anon;
