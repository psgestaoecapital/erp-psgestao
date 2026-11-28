-- Raio-X financeiro (Pdois/Julia) — FASE 1: diagnóstico determinístico e BARATO (SQL, sem LLM) das inconsistências
-- de lançamento que causam saldo errado (onboarding ago/set). Função de leitura, escopada à empresa do usuário pela
-- MESMA trava fail-closed/RLS do fn_caixa_grupo_dia. STABLE, REVOKE anon. Chamada ao abrir a tela (barato).
-- Checks desta fase: (1) saldo da conta (sistema) x extrato — reusa o cálculo da PRÓPRIA tela (fn_caixa_grupo_dia),
-- não recalcula diferente; (3) marca se a conta divergente teve saldo inicial lançado no período (onboarding);
-- (2) baixas no período cujo título não tem conta (não entram no saldo por conta); (6) títulos em aberto vencidos
-- há muito. Checks 4 (competência) e 5 (conciliação pendente) ficam para a próxima iteração.

CREATE OR REPLACE FUNCTION public.fn_fin_inconsistencias(p_company_ids uuid[], p_ini date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_ids uuid[];
  v_achados jsonb := '[]'::jsonb;
  v_dia jsonb;
  emp jsonb; ct jsonb;
  v_rec jsonb; v_pag jsonb; v_venc jsonb;
BEGIN
  -- Fail-closed por empresa (igual ao fn_caixa_grupo_dia): sem JWT = interna/service_role; logado → só as suas.
  IF coalesce(current_setting('request.jwt.claims', true), '') = '' OR auth.role() = 'service_role' THEN
    v_ids := p_company_ids;
  ELSE
    SELECT array_agg(x) INTO v_ids FROM unnest(p_company_ids) x WHERE x IN (SELECT get_user_company_ids());
  END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ini', p_ini, 'fim', p_fim, 'achados', '[]'::jsonb, 'n', 0);
  END IF;

  -- CHECK 1 (+3): saldo sistema x extrato por conta — reusa o fn_caixa_grupo_dia (mesma "Diferença" da tela).
  v_dia := public.fn_caixa_grupo_dia(v_ids, p_fim);
  FOR emp IN SELECT value FROM jsonb_array_elements(coalesce(v_dia->'empresas','[]'::jsonb)) LOOP
    FOR ct IN SELECT value FROM jsonb_array_elements(coalesce(emp->'contas','[]'::jsonb)) LOOP
      IF (ct->>'saldo_extrato') IS NOT NULL
         AND abs((ct->>'saldo_final')::numeric - (ct->>'saldo_extrato')::numeric) > 0.01 THEN
        v_achados := v_achados || jsonb_build_object(
          'tipo', 'saldo_divergente', 'severidade', 'alta',
          'empresa', emp->>'nome', 'conta', ct->>'nome',
          'descricao', 'O saldo desta conta no sistema não bate com o extrato do banco.',
          'valor', round((ct->>'saldo_final')::numeric - (ct->>'saldo_extrato')::numeric, 2),
          'data', ct->>'saldo_extrato_em',
          'ids', case when (ct->>'conta_id') is not null then jsonb_build_array(ct->>'conta_id') else '[]'::jsonb end,
          'onboarding', coalesce((SELECT bc.data_saldo_inicial BETWEEN p_ini AND p_fim
                                    FROM erp_banco_contas bc WHERE bc.id = (ct->>'conta_id')::uuid), false),
          'como_resolver', 'Concilie os lançamentos da conta (ou ajuste o saldo inicial, se foi lançado na implantação) e confira as baixas sem conta abaixo.');
      END IF;
    END LOOP;
  END LOOP;

  -- CHECK 2: baixas no período cujo TÍTULO não tem conta (ficam de fora do saldo por conta → causam divergência).
  SELECT jsonb_build_object('n', count(*), 'total', round(coalesce(sum(b.valor),0),2),
           'ids', coalesce(jsonb_agg(b.id ORDER BY b.data DESC) FILTER (WHERE rn <= 20), '[]'::jsonb))
    INTO v_rec
    FROM (SELECT b.id, b.valor, b.data, row_number() OVER (ORDER BY b.data DESC) AS rn
            FROM erp_receber_baixa b JOIN erp_receber r ON r.id = b.receber_id
           WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN p_ini AND p_fim
             AND r.conta_bancaria_id IS NULL) b;
  IF (v_rec->>'n')::int > 0 THEN
    v_achados := v_achados || jsonb_build_object('tipo','baixa_sem_conta_receber','severidade','alta',
      'descricao', (v_rec->>'n')||' recebimento(s) no período sem conta bancária definida.',
      'valor', (v_rec->>'total')::numeric, 'ids', v_rec->'ids',
      'como_resolver','Abra cada recebimento e informe a conta onde o dinheiro entrou, para ele somar no saldo da conta.');
  END IF;

  SELECT jsonb_build_object('n', count(*), 'total', round(coalesce(sum(b.valor),0),2),
           'ids', coalesce(jsonb_agg(b.id ORDER BY b.data DESC) FILTER (WHERE rn <= 20), '[]'::jsonb))
    INTO v_pag
    FROM (SELECT b.id, b.valor, b.data, row_number() OVER (ORDER BY b.data DESC) AS rn
            FROM erp_pagar_baixa b JOIN erp_pagar p ON p.id = b.pagar_id
           WHERE b.company_id = ANY(v_ids) AND b.deleted_at IS NULL AND b.data BETWEEN p_ini AND p_fim
             AND nullif(btrim(coalesce(p.conta_bancaria,'')),'') IS NULL) b;
  IF (v_pag->>'n')::int > 0 THEN
    v_achados := v_achados || jsonb_build_object('tipo','baixa_sem_conta_pagar','severidade','alta',
      'descricao', (v_pag->>'n')||' pagamento(s) no período sem conta bancária definida.',
      'valor', (v_pag->>'total')::numeric, 'ids', v_pag->'ids',
      'como_resolver','Abra cada pagamento e informe a conta de onde o dinheiro saiu, para ele abater o saldo da conta.');
  END IF;

  -- CHECK 6: títulos em aberto vencidos há mais de 60 dias (revisar se foram pagos fora do sistema).
  SELECT jsonb_build_object(
      'rec_n', count(*) FILTER (WHERE origem='receber'), 'rec_total', round(coalesce(sum(rem) FILTER (WHERE origem='receber'),0),2),
      'pag_n', count(*) FILTER (WHERE origem='pagar'), 'pag_total', round(coalesce(sum(rem) FILTER (WHERE origem='pagar'),0),2))
    INTO v_venc FROM (
      SELECT 'receber' AS origem, GREATEST(valor - coalesce(valor_pago,0),0) AS rem FROM erp_receber
        WHERE company_id = ANY(v_ids) AND deleted_at IS NULL AND status NOT IN ('cancelado','recebido','pago')
          AND data_vencimento < p_fim - 60 AND GREATEST(valor - coalesce(valor_pago,0),0) > 0.005
      UNION ALL
      SELECT 'pagar', GREATEST(valor - coalesce(valor_pago,0),0) FROM erp_pagar
        WHERE company_id = ANY(v_ids) AND deleted_at IS NULL AND status NOT IN ('cancelado','pago')
          AND data_vencimento < p_fim - 60 AND GREATEST(valor - coalesce(valor_pago,0),0) > 0.005
    ) v;
  IF (v_venc->>'rec_n')::int > 0 THEN
    v_achados := v_achados || jsonb_build_object('tipo','receber_vencido_antigo','severidade','baixa',
      'descricao', (v_venc->>'rec_n')||' título(s) a receber vencido(s) há mais de 60 dias ainda em aberto.',
      'valor', (v_venc->>'rec_total')::numeric, 'ids','[]'::jsonb,
      'como_resolver','Confira se já foram recebidos (dê baixa) ou renegocie/baixe o que não vai entrar.');
  END IF;
  IF (v_venc->>'pag_n')::int > 0 THEN
    v_achados := v_achados || jsonb_build_object('tipo','pagar_vencido_antigo','severidade','baixa',
      'descricao', (v_venc->>'pag_n')||' título(s) a pagar vencido(s) há mais de 60 dias ainda em aberto.',
      'valor', (v_venc->>'pag_total')::numeric, 'ids','[]'::jsonb,
      'como_resolver','Confira se já foram pagos (dê baixa) ou atualize o vencimento.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'ini', p_ini, 'fim', p_fim, 'achados', v_achados, 'n', jsonb_array_length(v_achados));
END $fn$;

REVOKE ALL ON FUNCTION public.fn_fin_inconsistencias(uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fin_inconsistencias(uuid[], date, date) TO authenticated, service_role;

-- RD-95: "?" do bloco e dos tipos de achado (linguagem da Julia).
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('financeiro.raiox.bloco', '/dashboard/financeiro/caixa-grupo', 'Raio-X financeiro', 'Raio-X financeiro',
  'Uma verificação automática (sem custo de IA) das inconsistências do período: saldo que não bate, lançamento sem conta, títulos vencidos antigos.',
  'Mostra, ao abrir a tela, onde provavelmente está o erro que faz o saldo divergir — com o caminho para corrigir.',
  '"3 inconsistências" → conta X difere R$ 1.200; 2 recebimentos sem conta em setembro.', 'Ignorar os achados de severidade alta.',
  'gestao_empresarial', 30, 1, 'publicado'),
 ('financeiro.raiox.saldo_divergente', '/dashboard/financeiro/caixa-grupo', 'Raio-X financeiro', 'Saldo divergente',
  'O saldo da conta no sistema não bate com o extrato do banco pela diferença mostrada.',
  'Aponta a conta e quanto difere; em geral é baixa sem conta ou saldo inicial da implantação.',
  'Conta "Sicredi" difere R$ 1.200,00 do extrato.', 'Mexer no saldo inicial sem conferir as baixas antes.',
  'gestao_empresarial', 31, 1, 'publicado'),
 ('financeiro.raiox.baixa_sem_conta', '/dashboard/financeiro/caixa-grupo', 'Raio-X financeiro', 'Lançamento sem conta',
  'Recebimentos/pagamentos baixados no período sem dizer em qual conta o dinheiro entrou/saiu.',
  'Esses lançamentos não somam no saldo por conta — costumam ser a causa da divergência.',
  '2 recebimentos de setembro sem conta, somando R$ 900.', 'Deixar a baixa sem conta ao dar baixa manual.',
  'gestao_empresarial', 32, 1, 'publicado'),
 ('financeiro.raiox.vencido_antigo', '/dashboard/financeiro/caixa-grupo', 'Raio-X financeiro', 'Vencidos antigos',
  'Títulos vencidos há mais de 60 dias ainda em aberto.',
  'Sinaliza o que talvez tenha sido pago/recebido fora do sistema e não foi baixado.',
  '1 título a pagar vencido em julho ainda aberto.', 'Deixar títulos velhos abertos distorcendo o "a receber/a pagar".',
  'gestao_empresarial', 33, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
