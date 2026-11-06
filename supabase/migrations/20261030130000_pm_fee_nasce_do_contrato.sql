-- P&M · Onda PM-F, PR F1 (CEO 28/10/2026 16:41, Documento Mestre P&M V30 §00-F):
-- "o contrato ativo gera o FEE — espelho resumido do que foi contratado".
--
-- 1) Ao ATIVAR um contrato de receita na GE (erp_contratos.status → 'ativo', por qualquer caminho: tela, função ou update),
--    nasce na P&M o fee (agency_contratos + agency_contrato_itens), ligado ao contrato da GE (erp_contrato_id).
--    Idempotente: 1 fee por contrato da GE; ativar de novo só reabre/atualiza o valor do fee existente.
--    Itens: copiados de agency_proposta_itens (a fonte real; fn_agency_contrato_criar lia agency_propostas.itens jsonb).
--    Contrato sem proposta: 1 item "objeto do contrato" para o atendimento detalhar.
--    Só em empresa que usa a P&M (tem catálogo de serviços ou o contrato veio de proposta da P&M).
--    Falha na geração do fee NUNCA bloqueia a ativação: vira evento 'fee_erro' no histórico do contrato.
-- 2) Pedido de contrato (status 'solicitado') avisa TODOS os usuários com papel 'financeiro' na empresa
--    (sem nenhum: sócios/acesso total). Com exatamente 1 financeiro, o aviso já sai das funções de origem
--    (fn_agency_proposta_aprovar / fn_contrato_solicitar) — este gatilho não duplica.
-- 3) Cada mudança de status do contrato avisa o SOLICITANTE (comercial), com link para o contrato.
--
-- Aditiva: funções e gatilhos NOVOS + 1 índice único parcial (agency_contratos hoje com 0 linhas ligadas à GE).
-- Não altera nenhuma função existente nem dado de cliente. Toca o núcleo de contratos (gatilho em erp_contratos):
-- PR com revisao-eng-chefe + OK do CEO.

CREATE UNIQUE INDEX IF NOT EXISTS ux_agency_contratos_erp_contrato
  ON public.agency_contratos (erp_contrato_id) WHERE erp_contrato_id IS NOT NULL;

-- ── 1. Gera (ou reabre) o fee de um contrato ativo da GE ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pm_fee_gerar_do_contrato(p_erp_contrato_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  c erp_contratos%ROWTYPE;
  v_prop agency_propostas%ROWTYPE;
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_fee uuid; v_agency_cli uuid; v_tipo text; v_itens int := 0; v_usa_pm boolean;
BEGIN
  SELECT * INTO c FROM erp_contratos WHERE id = p_erp_contrato_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado'); END IF;
  -- chamada pelo gatilho (sem JWT) passa; usuário só na própria empresa
  IF NOT (v_interno OR auth.role() = 'service_role' OR c.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF c.status IS DISTINCT FROM 'ativo' THEN RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_ativo'); END IF;
  IF COALESCE(c.natureza, 'receita') <> 'receita' THEN RETURN jsonb_build_object('ok', true, 'ignorado', 'despesa'); END IF;

  IF c.proposta_id IS NOT NULL THEN
    SELECT * INTO v_prop FROM agency_propostas WHERE id = c.proposta_id AND company_id = c.company_id;
  END IF;
  v_usa_pm := v_prop.id IS NOT NULL OR EXISTS (SELECT 1 FROM agency_servico s WHERE s.company_id = c.company_id);
  IF NOT v_usa_pm THEN RETURN jsonb_build_object('ok', true, 'ignorado', 'empresa_sem_pm'); END IF;

  -- idempotência: 1 fee por contrato da GE
  SELECT id INTO v_fee FROM agency_contratos WHERE erp_contrato_id = c.id;
  IF v_fee IS NOT NULL THEN
    UPDATE agency_contratos
       SET status = 'ativo', fee_mensal = COALESCE(c.valor_atual, c.valor_mensal, fee_mensal),
           dia_vencimento = COALESCE(c.dia_vencimento, dia_vencimento), data_fim = c.data_fim, atualizado_em = now()
     WHERE id = v_fee;
    RETURN jsonb_build_object('ok', true, 'fee_id', v_fee, 'ja_existia', true);
  END IF;

  -- cliente: o da GE é o mestre; o perfil P&M é resolvido a partir dele
  IF c.cliente_id IS NOT NULL THEN
    v_agency_cli := fn_agency_cliente_resolver(c.company_id, c.cliente_id);
  END IF;
  v_agency_cli := COALESCE(v_agency_cli, v_prop.cliente_id);

  v_tipo := CASE WHEN COALESCE(c.periodicidade, 'mensal') IN ('mensal','bimestral','trimestral','semestral','anual')
                      AND c.numero_parcelas IS NULL THEN 'recorrente' ELSE 'projeto' END;

  INSERT INTO agency_contratos (company_id, cliente_id, erp_cliente_id, proposta_id, tipo, fee_mensal, valor_projeto,
                                dia_vencimento, data_inicio, data_fim, status, responsavel_id, erp_contrato_id, observacoes)
  VALUES (c.company_id, v_agency_cli, c.cliente_id, v_prop.id, v_tipo,
          COALESCE(c.valor_atual, c.valor_mensal), CASE WHEN v_tipo = 'projeto' THEN COALESCE(c.valor_atual, c.valor_mensal) END,
          c.dia_vencimento, c.data_inicio, c.data_fim, 'ativo', COALESCE(v_prop.responsavel_id, c.solicitante_id), c.id,
          format('Fee gerado na ativação do contrato %s.', COALESCE(c.numero, c.id::text)))
  RETURNING id INTO v_fee;

  IF v_prop.id IS NOT NULL THEN
    INSERT INTO agency_contrato_itens (company_id, contrato_id, servico_id, tipo_servico, quantidade_contratada, unidade,
                                       periodicidade, valor_unitario, origem, confirmado)
    SELECT c.company_id, v_fee, i.servico_id,
           COALESCE(NULLIF(btrim(i.tipo_servico), ''), NULLIF(btrim(i.descricao), ''), 'Serviço'),
           COALESCE(i.quantidade, 1), NULLIF(btrim(i.unidade), ''),
           COALESCE(NULLIF(btrim(i.periodicidade), ''), CASE WHEN v_tipo = 'recorrente' THEN 'mensal' ELSE 'unica' END),
           i.valor_unitario, 'proposta', true
      FROM agency_proposta_itens i
     WHERE i.proposta_id = v_prop.id AND i.excluido_em IS NULL
     ORDER BY i.ordem;
    GET DIAGNOSTICS v_itens = ROW_COUNT;
  END IF;
  IF v_itens = 0 THEN
    INSERT INTO agency_contrato_itens (company_id, contrato_id, tipo_servico, quantidade_contratada, periodicidade,
                                       valor_unitario, origem, confirmado, trecho)
    VALUES (c.company_id, v_fee, left(COALESCE(NULLIF(btrim(c.objeto), ''), NULLIF(btrim(c.nome), ''), 'Objeto do contrato'), 200),
            1, CASE WHEN v_tipo = 'recorrente' THEN 'mensal' ELSE 'unica' END,
            COALESCE(c.valor_atual, c.valor_mensal), 'contrato', false, left(c.escopo, 2000));
    v_itens := 1;
  END IF;

  RETURN jsonb_build_object('ok', true, 'fee_id', v_fee, 'ja_existia', false, 'itens', v_itens);
END $fn$;

REVOKE ALL ON FUNCTION public.fn_pm_fee_gerar_do_contrato(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_fee_gerar_do_contrato(uuid) TO authenticated, service_role;

-- ── 2. Gatilho: ativação → fee (nunca bloqueia a ativação) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_erp_contrato_fee_pm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
-- ci-sem-guarda: trg_erp_contrato_fee_pm — gatilho do próprio contrato gravado; só cria o fee DESTE contrato
DECLARE v_res jsonb;
BEGIN
  BEGIN
    v_res := public.fn_pm_fee_gerar_do_contrato(NEW.id);
    IF (v_res->>'ok')::boolean AND v_res ? 'fee_id' AND NOT COALESCE((v_res->>'ja_existia')::boolean, false) THEN
      INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
      VALUES (NEW.id, NEW.company_id, 'fee_gerado', 'Fee da P&M gerado na ativação do contrato', v_res, auth.uid(), now());
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
    VALUES (NEW.id, NEW.company_id, 'fee_erro', 'Não foi possível gerar o fee da P&M: ' || SQLERRM,
            jsonb_build_object('sqlstate', SQLSTATE), auth.uid(), now());
  END;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_erp_contrato_fee_pm_upd ON public.erp_contratos;
CREATE TRIGGER trg_erp_contrato_fee_pm_upd
  AFTER UPDATE OF status ON public.erp_contratos
  FOR EACH ROW WHEN (NEW.status = 'ativo' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.trg_erp_contrato_fee_pm();
DROP TRIGGER IF EXISTS trg_erp_contrato_fee_pm_ins ON public.erp_contratos;
CREATE TRIGGER trg_erp_contrato_fee_pm_ins
  AFTER INSERT ON public.erp_contratos
  FOR EACH ROW WHEN (NEW.status = 'ativo')
  EXECUTE FUNCTION public.trg_erp_contrato_fee_pm();

-- ── 3. Avisos do pedido de contrato (financeiro) e das mudanças de status (solicitante) ───────────────
CREATE OR REPLACE FUNCTION public.trg_erp_contrato_avisos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
-- ci-sem-guarda: trg_erp_contrato_avisos — gatilho do próprio contrato gravado; só grava avisos da empresa DESTE contrato
DECLARE v_n_fin int; v_link text := '/dashboard/contratos?tab=fee&c=' || NEW.id; v_rot text;
BEGIN
  IF COALESCE(NEW.natureza, 'receita') <> 'receita' THEN RETURN NULL; END IF;

  -- (a) pedido novo → todos os financeiros (exatamente 1: a função de origem já avisou)
  IF TG_OP = 'INSERT' AND NEW.status = 'solicitado' THEN
    SELECT count(*) INTO v_n_fin FROM user_companies WHERE company_id = NEW.company_id AND role = 'financeiro';
    IF v_n_fin <> 1 THEN
      INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
      SELECT NEW.company_id, uc.user_id, 'contrato_solicitado', 'Contrato solicitado ' || COALESCE(NEW.numero, ''),
             format('%s — %s', COALESCE(NEW.cliente_nome, 'cliente'), COALESCE(NEW.nome, 'pedido de contrato')),
             v_link, 'erp_contratos', NEW.id, auth.uid()
        FROM user_companies uc
       WHERE uc.company_id = NEW.company_id
         AND uc.role = ANY (CASE WHEN v_n_fin > 1 THEN ARRAY['financeiro'] ELSE ARRAY['socio','acesso_total'] END)
         AND uc.user_id IS DISTINCT FROM auth.uid();
    END IF;
  END IF;

  -- (b) mudança de status → quem pediu (comercial)
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.solicitante_id IS NOT NULL
     AND NEW.solicitante_id IS DISTINCT FROM auth.uid() THEN
    v_rot := CASE NEW.status
      WHEN 'em_elaboracao' THEN 'em elaboração' WHEN 'aguardando_info' THEN 'aguardando informação sua'
      WHEN 'em_revisao' THEN 'em revisão' WHEN 'aguardando_aprovacao' THEN 'aguardando aprovação'
      WHEN 'ativo' THEN 'ativo — o fee já está na P&M' ELSE NEW.status END;
    INSERT INTO erp_notificacao_usuario (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    VALUES (NEW.company_id, NEW.solicitante_id, 'contrato_status',
            format('Contrato %s: %s', COALESCE(NEW.numero, ''), v_rot),
            format('%s — %s', COALESCE(NEW.cliente_nome, 'cliente'), COALESCE(NEW.nome, '')),
            v_link, 'erp_contratos', NEW.id, auth.uid());
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS trg_erp_contrato_avisos ON public.erp_contratos;
CREATE TRIGGER trg_erp_contrato_avisos
  AFTER INSERT OR UPDATE OF status ON public.erp_contratos
  FOR EACH ROW EXECUTE FUNCTION public.trg_erp_contrato_avisos();

REVOKE ALL ON FUNCTION public.trg_erp_contrato_fee_pm() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_erp_contrato_avisos() FROM PUBLIC, anon;
