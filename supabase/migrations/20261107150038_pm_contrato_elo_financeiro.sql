-- PDCA P&M · /dashboard/pm/contratos · ELO contrato da agência (P&M) → financeiro (GE)
-- Reauditoria CEO 06/11 (auditor_pdca_2, RD-38, DEMO b0700000-0000-4000-a000-000000000002):
-- 5/6 contratos agency recorrentes NUNCA chegavam ao financeiro (erp_contrato_id NULL) —
-- "o financeiro não recebe a solicitação de contrato". Único caminho era a dupla digitação
-- (fn_agency_contrato_vincular_erp exigia o operador recriar o contrato na GE à mão).
--
-- Este elo fecha a jornada: ao ATIVAR um contrato recorrente da P&M ainda sem elo, cria
-- automaticamente a SOLICITAÇÃO de contrato no financeiro (erp_contratos status 'solicitado')
-- com o cliente e o fee já carregados, e liga o contrato da P&M a ela. O trigger de avisos
-- do erp_contratos (trg_erp_contrato_avisos) NOTIFICA o financeiro no mesmo instante: o
-- financeiro RECEBE a solicitação e ATIVA sem redigitar cliente/valor. A ativação na GE já
-- dispara o fee (trg_erp_contrato_fee_pm, idempotente — liga o contrato da P&M existente, não
-- duplica) e os títulos recorrentes (fn_contrato_gerar_receber).
--
-- SEGURANÇA / RD-94.1: SENSÍVEL — toca financeiro de cliente (cria erp_contratos) e faz
-- CREATE OR REPLACE de função existente → label revisao-eng-chefe + MERGE AUTORIZADO.
-- Aditiva e idempotente: só cria quando NÃO há erp_contrato_id; nunca apaga nem altera
-- título já gerado nem dado de cliente; guarda multi-tenant por company_id; REVOKE anon.
-- Como o erp_contrato nasce 'solicitado' (NÃO 'ativo'), NENHUM título é gerado antes de o
-- financeiro conferir e ativar — o comercial solicita, o financeiro recebe e decide.
--
-- Prova RD-38 (BEGIN…ROLLBACK, DEMO, statement_timeout 15s), rodada 2× (idempotência):
--   ativar contrato recorrente → erp_contrato 'solicitado' criado+ligado, financeiro notificado
--   (5 avisos) → financeiro ativa → agency_ligados=1 (SEM duplicata) → fn_contrato_gerar_receber
--   gera 1 título de R$ 2.500,00 (= fee) e a 2ª chamada é idempotente.

-- ───────────────────────────────────────────────────────────────────────────────────────
-- 1) Cria a "solicitação de contrato" no financeiro a partir do contrato recorrente da P&M.
--    Reutilizável pelo botão "Enviar ao financeiro" (contratos ativos ainda sem elo) e pela
--    ativação (abaixo). Idempotente: se já houver elo, não faz nada.
-- ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_solicitar_financeiro(p_agency_contrato_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_r   public.agency_contratos%ROWTYPE;
  v_cli public.erp_clientes%ROWTYPE;
  v_num varchar;
  v_nome varchar;
  v_erp uuid;
  v_ano text := to_char(current_date, 'YYYY');
BEGIN
  SELECT * INTO v_r FROM agency_contratos WHERE id = p_agency_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contrato_nao_encontrado');
  END IF;

  -- Guarda multi-tenant: empresa do contrato no escopo do usuário (chamada interna do gatilho
  -- de ativação — sem JWT — e service_role também passam).
  IF NOT (coalesce(current_setting('request.jwt.claims', true), '') = ''
          OR auth.role() = 'service_role'
          OR v_r.company_id IN (SELECT get_user_company_ids())
          OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- Idempotente: já ligado ao financeiro → nada a fazer.
  IF v_r.erp_contrato_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'ja_vinculado', true, 'erp_contrato_id', v_r.erp_contrato_id);
  END IF;

  -- Só gera cobrança recorrente quando há dados mínimos; senão, informa o que falta
  -- (o botão da tela mostra a mensagem; a ativação apenas ignora e segue).
  IF v_r.tipo IS DISTINCT FROM 'recorrente' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_recorrente');
  END IF;
  IF COALESCE(v_r.fee_mensal, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_fee_mensal');
  END IF;
  IF v_r.erp_cliente_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_cliente_financeiro');
  END IF;

  SELECT * INTO v_cli FROM erp_clientes
   WHERE id = v_r.erp_cliente_id AND company_id = v_r.company_id;

  -- numero único por empresa (trava a corrida no CTR-ANO-NNNN; índice único company_id+numero).
  PERFORM pg_advisory_xact_lock(hashtextextended('ctr_num:' || v_r.company_id::text || v_ano, 0));
  v_num := next_contrato_numero(v_r.company_id);

  v_nome := 'Contrato recorrente P&M — '
            || COALESCE(NULLIF(btrim(v_cli.nome_fantasia), ''),
                        NULLIF(btrim(v_cli.razao_social), ''), 'cliente');

  INSERT INTO erp_contratos (
    company_id, numero, cliente_id, cliente_nome, cliente_cnpj, cliente_email, cliente_telefone,
    tipo, nome, valor_mensal, data_inicio, data_fim, dia_vencimento, periodicidade, natureza,
    status, proposta_id, solicitante_id, origem, created_by
  ) VALUES (
    v_r.company_id, v_num, v_r.erp_cliente_id,
    COALESCE(NULLIF(btrim(v_cli.nome_fantasia), ''), NULLIF(btrim(v_cli.razao_social), '')),
    NULLIF(btrim(COALESCE(v_cli.cnpj_cpf, v_cli.cpf_cnpj)), ''),
    NULLIF(btrim(v_cli.email), ''),
    NULLIF(btrim(COALESCE(v_cli.telefone, v_cli.celular)), ''),
    'agencia_pm', v_nome, v_r.fee_mensal,
    COALESCE(v_r.data_inicio, current_date), v_r.data_fim,
    COALESCE(v_r.dia_vencimento, 10), 'mensal', 'receita',
    'solicitado', v_r.proposta_id, auth.uid(), 'agency_contrato', auth.uid()
  ) RETURNING id INTO v_erp;

  -- Liga o contrato da P&M à solicitação (o financeiro ativa sem redigitar).
  UPDATE agency_contratos
     SET erp_contrato_id = v_erp, atualizado_em = now()
   WHERE id = p_agency_contrato_id;

  RETURN jsonb_build_object('ok', true, 'erp_contrato_id', v_erp, 'numero', v_num, 'status', 'solicitado');
END $function$;

REVOKE ALL ON FUNCTION public.fn_agency_contrato_solicitar_financeiro(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_solicitar_financeiro(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────
-- 2) Ativação do contrato da P&M: ao virar 'ativo' um recorrente ainda sem elo, cria a
--    solicitação no financeiro (não-fatal: um erro aqui nunca bloqueia a ativação).
--    Corpo idêntico ao vivo + bloco novo ao final (guarda, idempotência e auditoria preservados).
-- ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_contrato_mudar_status(p_contrato_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_r public.agency_contratos%ROWTYPE;
  v_fin jsonb := NULL;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('rascunho','ativo','suspenso','encerrado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido');
  END IF;

  SELECT * INTO v_r FROM agency_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado');
  END IF;

  -- Guarda multi-tenant (RD-45): a empresa do contrato tem de estar no escopo do usuário (ou admin).
  IF NOT (v_r.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  -- Idempotente: mesmo status não gera escrita nem ruído no audit.
  IF v_r.status IS NOT DISTINCT FROM p_status THEN
    RETURN jsonb_build_object('ok', true, 'inalterado', true, 'status', p_status);
  END IF;

  UPDATE agency_contratos
     SET status = p_status, atualizado_em = now()
   WHERE id = p_contrato_id;

  IF v_uid IS NOT NULL THEN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_r.company_id, v_uid, COALESCE((SELECT email FROM users WHERE id = v_uid), ''),
            'agency_contratos', p_contrato_id::text, 'contrato_mudar_status',
            jsonb_build_object('status', v_r.status),
            jsonb_build_object('status', p_status));
  END IF;

  -- NOVO (elo financeiro): ao ATIVAR um recorrente ainda sem contrato na GE, cria a
  -- solicitação de contrato no financeiro. Não-fatal — igual ao gatilho de fee da GE,
  -- um problema aqui é registrado no retorno mas nunca derruba a ativação.
  IF p_status = 'ativo' AND v_r.tipo = 'recorrente' AND v_r.erp_contrato_id IS NULL THEN
    BEGIN
      v_fin := public.fn_agency_contrato_solicitar_financeiro(p_contrato_id);
    EXCEPTION WHEN OTHERS THEN
      v_fin := jsonb_build_object('ok', false, 'erro', 'excecao', 'sqlstate', SQLSTATE);
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', p_status, 'financeiro', v_fin);
END $function$;

REVOKE ALL ON FUNCTION public.fn_agency_contrato_mudar_status(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_contrato_mudar_status(uuid, text) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────
-- 3) RD-95 "?" das AÇÕES/INDICADOR novos da tela Fees/Contratos (P&M) · /dashboard/pm/contratos:
--    "Enviar ao financeiro" (um clique) e o selo de situação do contrato no financeiro.
--    Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente).
--    Idempotente (ON CONFLICT chave) — reaplicar não duplica.
-- ───────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/contratos', 'pm', 'publicado'
FROM (VALUES
 ('pm.contratos.acao_enviar_financeiro', 'Contratos · Ações', 'Enviar ao financeiro',
  'Ação (não é campo): envia este fee recorrente ao financeiro (Gestão Empresarial) em um clique. O financeiro RECEBE a solicitação com o cliente e o valor já preenchidos — não é preciso redigitar.',
  'Fecha a ponte comercial → financeiro: sem isso o fee não vira cobrança. Ao enviar, nasce uma solicitação de contrato (status "solicitado") que o financeiro confere e ativa; a ativação é que passa a gerar os títulos a receber.',
  'Fee recorrente de R$2.500/mês: um clique cria a solicitação no financeiro; a equipe financeira ativa e os boletos mensais passam a ser gerados.',
  'Esperar o boleto na hora: enviar só SOLICITA. O faturamento começa quando o financeiro ATIVA a cobrança.',
  40),
 ('pm.contratos.status_financeiro', 'Contratos · Indicadores', 'Situação no financeiro',
  'Indicador (não é campo): mostra onde o contrato está na ponte com o financeiro — "aguardando ativar" (solicitação enviada, financeiro ainda não ativou) ou "ativo no financeiro" (gerando faturamento).',
  'Deixa claro se o fee já fatura ou se ainda depende de o financeiro ativar — evita achar que um contrato enviado já está cobrando.',
  'Enviado hoje → "⏳ aguardando ativar"; depois que o financeiro ativa → "✅ ativo no financeiro".',
  'Confundir "aguardando ativar" com "ativo": enquanto estiver aguardando, nenhum título é gerado.',
  41)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO UPDATE SET
  grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, vertical = EXCLUDED.vertical, status = EXCLUDED.status;
