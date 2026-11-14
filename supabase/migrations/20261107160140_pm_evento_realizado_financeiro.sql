-- P&M · Eventos & Produções — Previsto × Realizado (auditor_pdca_2 07/11, blueprint critério h).
-- Hoje a tela só mostra o ORÇAMENTO PREVISTO; faltava o REALIZADO vindo do financeiro da GE (erp_pagar).
-- Tudo ADITIVO e multi-tenant (RD-45/RD-94.1): tabela de vínculo NOVA no domínio agency, nenhuma coluna de
-- erp_pagar alterada, nenhum dado de cliente tocado. Escrita só pelas RPCs (SECURITY DEFINER, guarda pela
-- empresa do evento, audit_log_global). Leitura por company_id (RLS). Sem anon. "?" (RD-95) nos novos indicadores.

-- ============================================================= 1) Tabela de vínculo evento × lançamento (erp_pagar)
CREATE TABLE IF NOT EXISTS public.agency_evento_pagar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evento_id uuid NOT NULL REFERENCES public.agency_eventos(id) ON DELETE CASCADE,
  lancamento_id uuid NOT NULL REFERENCES public.erp_pagar(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  CONSTRAINT agency_evento_pagar_lanc_unico UNIQUE (lancamento_id)   -- um custo pertence a no máximo um evento
);
CREATE INDEX IF NOT EXISTS idx_agency_evento_pagar_evento ON public.agency_evento_pagar (evento_id);
CREATE INDEX IF NOT EXISTS idx_agency_evento_pagar_company ON public.agency_evento_pagar (company_id);

ALTER TABLE public.agency_evento_pagar ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_evento_pagar'::regclass AND polname='agency_evento_pagar_sel') THEN
    CREATE POLICY agency_evento_pagar_sel ON public.agency_evento_pagar
      FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
END $$;
REVOKE ALL ON public.agency_evento_pagar FROM PUBLIC, anon;
GRANT SELECT ON public.agency_evento_pagar TO authenticated;

-- ============================================================= 2) RPCs (guarda pela empresa do evento)
-- Vincular um lançamento de contas a pagar (erp_pagar) da MESMA empresa ao evento.
CREATE OR REPLACE FUNCTION public.fn_pm_evento_pagar_vincular(p_evento_id uuid, p_lancamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_comp uuid; v_pcomp uuid; v_pdel timestamptz; v_id uuid; v_ja uuid;
BEGIN
  SELECT company_id INTO v_comp FROM agency_eventos WHERE id = p_evento_id AND excluido_em IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','evento não encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  SELECT company_id, deleted_at INTO v_pcomp, v_pdel FROM erp_pagar WHERE id = p_lancamento_id;
  IF v_pcomp IS NULL OR v_pdel IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'erro','lançamento não encontrado'); END IF;
  IF v_pcomp <> v_comp THEN RETURN jsonb_build_object('ok',false,'erro','o lançamento é de outra empresa'); END IF;
  SELECT evento_id INTO v_ja FROM agency_evento_pagar WHERE lancamento_id = p_lancamento_id;
  IF v_ja IS NOT NULL THEN
    IF v_ja = p_evento_id THEN RETURN jsonb_build_object('ok',true,'id',NULL,'ja_vinculado',true); END IF;
    RETURN jsonb_build_object('ok',false,'erro','este custo já está vinculado a outro evento');
  END IF;
  INSERT INTO agency_evento_pagar (company_id, evento_id, lancamento_id)
  VALUES (v_comp, p_evento_id, p_lancamento_id) RETURNING id INTO v_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_comp, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_evento_pagar', v_id, 'evento_pagar_vincular',
          NULL, jsonb_build_object('evento_id',p_evento_id,'lancamento_id',p_lancamento_id));
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $function$;

-- Desvincular (remove só o vínculo; NUNCA toca o lançamento em erp_pagar). Rastreado em audit_log_global.
CREATE OR REPLACE FUNCTION public.fn_pm_evento_pagar_desvincular(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_ant agency_evento_pagar%ROWTYPE;
BEGIN
  SELECT * INTO v_ant FROM agency_evento_pagar WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'erro','vínculo não encontrado'); END IF;
  IF NOT (v_ant.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  DELETE FROM agency_evento_pagar WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_ant.company_id, v_uid, (SELECT email FROM users WHERE id=v_uid), 'agency_evento_pagar', p_id, 'evento_pagar_desvincular',
          jsonb_build_object('evento_id',v_ant.evento_id,'lancamento_id',v_ant.lancamento_id,'motivo',nullif(btrim(p_motivo),'')), NULL);
  RETURN jsonb_build_object('ok',true);
END $function$;

-- Resultado de UM evento: previsto, realizado (comprometido, exclui cancelado), pago, a pagar, saldo e %.
-- "realizado = pago + a pagar" (blueprint): realizado = soma de valor dos custos vinculados não cancelados.
CREATE OR REPLACE FUNCTION public.fn_pm_evento_resultado(p_evento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid; v_prev numeric; v_real numeric := 0; v_pago numeric := 0; v_apagar numeric := 0; v_qtd int := 0;
BEGIN
  SELECT company_id, COALESCE(orcamento_previsto,0) INTO v_comp, v_prev FROM agency_eventos WHERE id = p_evento_id AND excluido_em IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok',false,'erro','evento não encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN jsonb_build_object('ok',false,'erro','sem acesso'); END IF;
  SELECT
    COALESCE(sum(p.valor),0),
    COALESCE(sum(CASE WHEN p.status IN ('pago','parcial') THEN COALESCE(p.valor_pago,0) ELSE 0 END),0),
    count(*)
  INTO v_real, v_pago, v_qtd
  FROM agency_evento_pagar v JOIN erp_pagar p ON p.id = v.lancamento_id
  WHERE v.evento_id = p_evento_id AND p.deleted_at IS NULL AND p.status <> 'cancelado';
  v_apagar := round(v_real - v_pago, 2);
  RETURN jsonb_build_object(
    'ok', true, 'previsto', round(v_prev,2), 'realizado', round(v_real,2), 'pago', round(v_pago,2),
    'a_pagar', v_apagar, 'saldo', round(v_prev - v_real, 2),
    'pct', CASE WHEN v_prev > 0 THEN round(v_real * 100.0 / v_prev, 1) ELSE NULL END, 'qtd', v_qtd
  );
END $function$;

-- Resultado de TODOS os eventos ativos da empresa (para a coluna/KPI da lista numa chamada só).
CREATE OR REPLACE FUNCTION public.fn_pm_eventos_resultado(p_company_id uuid)
RETURNS TABLE (evento_id uuid, previsto numeric, realizado numeric, saldo numeric, pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT e.id,
         round(COALESCE(e.orcamento_previsto,0),2) AS previsto,
         round(COALESCE(r.realizado,0),2) AS realizado,
         round(COALESCE(e.orcamento_previsto,0) - COALESCE(r.realizado,0),2) AS saldo,
         CASE WHEN COALESCE(e.orcamento_previsto,0) > 0 THEN round(COALESCE(r.realizado,0)*100.0/e.orcamento_previsto,1) END AS pct
    FROM agency_eventos e
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(p.valor),0) AS realizado
        FROM agency_evento_pagar v JOIN erp_pagar p ON p.id = v.lancamento_id
       WHERE v.evento_id = e.id AND p.deleted_at IS NULL AND p.status <> 'cancelado'
    ) r ON true
   WHERE e.company_id = p_company_id AND e.excluido_em IS NULL
     AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin());
$function$;

-- Lançamentos de erp_pagar JÁ vinculados ao evento (com detalhe para a tela).
CREATE OR REPLACE FUNCTION public.fn_pm_evento_pagar_listar(p_evento_id uuid)
RETURNS TABLE (vinculo_id uuid, lancamento_id uuid, descricao text, fornecedor text, valor numeric, valor_pago numeric, status text, data_vencimento date, data_pagamento date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT v.id, p.id, COALESCE(p.descricao,'(sem descrição)')::text, COALESCE(p.fornecedor_nome,'—')::text,
         COALESCE(p.valor,0), COALESCE(p.valor_pago,0), p.status::text, p.data_vencimento, p.data_pagamento
    FROM agency_evento_pagar v
    JOIN agency_eventos e ON e.id = v.evento_id
    JOIN erp_pagar p ON p.id = v.lancamento_id AND p.deleted_at IS NULL
   WHERE v.evento_id = p_evento_id
     AND (e.company_id IN (SELECT get_user_company_ids()) OR is_admin())
   ORDER BY p.data_vencimento NULLS LAST, p.descricao;
$function$;

-- Lançamentos de erp_pagar da empresa AINDA NÃO vinculados a nenhum evento (para o seletor "Vincular custo").
CREATE OR REPLACE FUNCTION public.fn_pm_evento_pagar_disponiveis(p_company_id uuid, p_busca text DEFAULT NULL, p_limite int DEFAULT 50)
RETURNS TABLE (lancamento_id uuid, descricao text, fornecedor text, valor numeric, status text, data_vencimento date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.id, COALESCE(p.descricao,'(sem descrição)')::text, COALESCE(p.fornecedor_nome,'—')::text,
         COALESCE(p.valor,0), p.status::text, p.data_vencimento
    FROM erp_pagar p
   WHERE p.company_id = p_company_id AND p.deleted_at IS NULL AND p.status <> 'cancelado'
     AND NOT EXISTS (SELECT 1 FROM agency_evento_pagar v WHERE v.lancamento_id = p.id)
     AND (p_busca IS NULL OR p.descricao ILIKE '%'||p_busca||'%' OR p.fornecedor_nome ILIKE '%'||p_busca||'%')
     AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())
   ORDER BY p.data_vencimento DESC NULLS LAST
   LIMIT GREATEST(1, LEAST(COALESCE(p_limite,50), 200));
$function$;

REVOKE ALL ON FUNCTION public.fn_pm_evento_pagar_vincular(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_pagar_desvincular(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_resultado(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_eventos_resultado(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_pagar_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_pm_evento_pagar_disponiveis(uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_pagar_vincular(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_pagar_desvincular(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_resultado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_eventos_resultado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_pagar_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_pm_evento_pagar_disponiveis(uuid, text, int) TO authenticated;

-- ============================================================= 3) Ajuda "?" (RD-95) dos novos indicadores/ações
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.eventos.kpi_realizado', '/dashboard/pm/eventos', 'Eventos · Resultado', 'Realizado', 'Soma dos custos do financeiro (contas a pagar) vinculados aos eventos do filtro — o que foi efetivamente comprometido (pago + a pagar).', 'Comparar o que foi gasto com o que estava previsto.', 'Previsto R$ 8.500 · Realizado R$ 6.200.', 'Confundir com os itens planejados: aqui é o custo real do financeiro.', 'pm', 37, 1, 'publicado'),
 ('pm.eventos.kpi_saldo', '/dashboard/pm/eventos', 'Eventos · Resultado', 'Saldo', 'Previsto menos realizado dos eventos do filtro. Positivo = dentro do orçamento; negativo = estourou.', 'Saber se os eventos estão dentro ou fora do orçamento.', 'Previsto R$ 8.500 − Realizado R$ 6.200 = Saldo R$ 2.300.', '—', 'pm', 38, 1, 'publicado'),
 ('pm.eventos.col_realizado', '/dashboard/pm/eventos', 'Eventos · Lista', 'Realizado', 'Custo real (contas a pagar vinculadas) deste evento.', 'Ver o gasto de cada evento ao lado do previsto.', 'R$ 6.200 realizados de R$ 8.500 previstos.', 'Vazio (—) quando nenhum custo foi vinculado ainda.', 'pm', 39, 1, 'publicado'),
 ('pm.eventos.col_saldo', '/dashboard/pm/eventos', 'Eventos · Lista', 'Saldo / %', 'Previsto menos realizado do evento e o % do previsto já consumido.', 'Enxergar de relance quais eventos estão estourando.', 'Saldo R$ 2.300 · 73% do previsto.', '—', 'pm', 40, 1, 'publicado'),
 ('pm.eventos.custos_titulo', '/dashboard/pm/eventos', 'Eventos · Custos', 'Custos realizados (financeiro)', 'Lançamentos de contas a pagar da GE vinculados a este evento. É daqui que vem o Realizado.', 'Ligar o evento ao financeiro para medir previsto × realizado.', 'Vincular a nota do buffet e a diária da equipe.', 'Sem custo vinculado o realizado fica R$ 0,00.', 'pm', 41, 1, 'publicado'),
 ('pm.eventos.custos_vincular', '/dashboard/pm/eventos', 'Eventos · Custos', 'Vincular custo', 'Escolhe um lançamento de contas a pagar da empresa (ainda não vinculado) para somar ao realizado do evento.', 'Trazer o custo real do financeiro para o evento sem redigitar.', 'Vincular custo → "Buffet — R$ 2.400".', 'O custo precisa já existir em Contas a pagar da GE.', 'pm', 42, 1, 'publicado'),
 ('pm.eventos.custos_desvincular', '/dashboard/pm/eventos', 'Eventos · Custos', 'Desvincular', 'Remove o vínculo do custo com o evento (o lançamento continua intacto no financeiro). Fica na auditoria.', 'Corrigir um custo vinculado por engano sem apagar o lançamento.', 'Desvincular um custo que era de outro evento.', 'Isto não exclui a conta a pagar — só o vínculo.', 'pm', 43, 1, 'publicado'),
 ('pm.eventos.custos_busca', '/dashboard/pm/eventos', 'Eventos · Custos', 'Buscar custo', 'Filtra os lançamentos de contas a pagar disponíveis pelo texto da descrição ou do fornecedor.', 'Achar rápido o custo certo para vincular ao evento.', 'Digite “buffet” para achar a nota do buffet.', '—', 'pm', 44, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
