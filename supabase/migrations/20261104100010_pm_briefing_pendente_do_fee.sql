-- P&M · Briefing pendente a partir do fee (pedido da supervisão P&M via CEO; refina o chamado #5461).
--
-- Fluxo oficial: contrato ativo → fee → BRIEFING → planejamento → jobs.
-- Reusa os status que a tela de Briefings já trata (novo, em_analise, aprovado, virou_job); nenhum status novo.
-- 1) Ao nascer o fee de um contrato da GE, cria sozinho um briefing com status 'novo' ligado ao fee (campos vazios,
--    a supervisora preenche). Idempotente: não cria outro enquanto houver um 'novo' do mesmo fee.
--    Não bloqueia a geração do fee: falha vira aviso no log do banco.
-- 2) fn_agency_briefing_lancar: grava o briefing trabalhado com o cliente e move 'novo' → 'em_analise'.
--    Guarda de empresa (get_user_company_ids / is_admin) e só age em briefing 'novo' (idempotência da ação).
--
-- Aditiva: 2 funções novas e 1 gatilho novo. Reusa agency_briefings (sem tabela nova); não altera o fee nem o
-- contrato. Fees que já existem NÃO ganham briefing retroativo.

-- ── 1. Gatilho: fee novo de contrato ativo → briefing 'novo' ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_agency_fee_briefing_pendente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
-- ci-sem-guarda: trg_agency_fee_briefing_pendente — gatilho do próprio fee gravado; só cria briefing 'novo' DESTE fee
DECLARE
  v_cliente text;
  v_mes text;
  v_meses text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
BEGIN
  IF EXISTS (SELECT 1 FROM agency_briefings b
              WHERE b.fee_id = NEW.id AND b.status = 'novo' AND b.excluido_em IS NULL) THEN
    RETURN NULL;
  END IF;
  IF NEW.cliente_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(c.nome_fantasia), ''), c.nome) INTO v_cliente FROM agency_clientes c WHERE c.id = NEW.cliente_id;
  END IF;
  v_mes := v_meses[extract(month FROM COALESCE(NEW.data_inicio, now()))::int] || '/' || extract(year FROM COALESCE(NEW.data_inicio, now()))::int;
  INSERT INTO agency_briefings (company_id, cliente_id, titulo, fee_id, status)
  VALUES (NEW.company_id, NEW.cliente_id, 'Briefing — ' || COALESCE(v_cliente, 'cliente') || ' — ' || v_mes, NEW.id, 'novo');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- a geração do fee nunca pode falhar por causa do briefing
  RAISE WARNING 'briefing do fee % não criado: %', NEW.id, SQLERRM;
  RETURN NULL;
END $fn$;

REVOKE ALL ON FUNCTION public.trg_agency_fee_briefing_pendente() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_agency_fee_briefing_pendente ON public.agency_contratos;
CREATE TRIGGER trg_agency_fee_briefing_pendente
  AFTER INSERT ON public.agency_contratos
  FOR EACH ROW WHEN (NEW.erp_contrato_id IS NOT NULL AND NEW.status = 'ativo')
  EXECUTE FUNCTION public.trg_agency_fee_briefing_pendente();

-- ── 2. Lançar o briefing trabalhado com o cliente (novo → em_analise) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_briefing_lancar(p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  b agency_briefings%ROWTYPE;
  v_titulo text := btrim(COALESCE(p_dados->>'titulo', ''));
BEGIN
  SELECT * INTO b FROM agency_briefings WHERE id = p_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'briefing_nao_encontrado'); END IF;
  IF NOT (b.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF b.status IS DISTINCT FROM 'novo' THEN RETURN jsonb_build_object('ok', false, 'erro', 'briefing_nao_novo'); END IF;
  IF v_titulo = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'titulo_obrigatorio'); END IF;

  UPDATE agency_briefings
     SET titulo = v_titulo,
         objetivo = NULLIF(btrim(p_dados->>'objetivo'), ''),
         descricao = NULLIF(btrim(p_dados->>'descricao'), ''),
         publico_alvo = NULLIF(btrim(p_dados->>'publico_alvo'), ''),
         referencias = NULLIF(btrim(p_dados->>'referencias'), ''),
         tipo_servico = NULLIF(btrim(p_dados->>'tipo_servico'), ''),
         prazo_desejado = NULLIF(p_dados->>'prazo_desejado', '')::date,
         status = 'em_analise',
         updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'status', 'em_analise');
END $fn$;

REVOKE ALL ON FUNCTION public.fn_agency_briefing_lancar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_briefing_lancar(uuid, jsonb) TO authenticated, service_role;
