-- A2 SEGURANÇA — fecha exposição de auth.users a 'authenticated' nas 3 views do BPO.
-- P0 (migração anterior) tirou o anon (internet). Restou 'authenticated' = qualquer logado de qualquer
-- tenant. Mecanismo: guarda public.is_admin() (role IN 'adm','acesso_total') dentro de cada view →
-- não-admin recebe 0 linhas. Sem mudança de frontend. Reversível (recriar as views sem o predicado).
--
-- Diff vs original (auditado): a ÚNICA mudança em cada view é o predicado public.is_admin() (nenhuma coluna
-- ou lógica alterada). REVOKE de escrita de 'authenticated' (SELECT permanece, agora protegido pela guarda).
--
-- Prova (RD-38, via MCP = sem JWT = usuário comum): is_admin()=false → as 3 views retornam 0 linhas;
-- base tem 10 empresas com contrato BPO ativo (admin veria >0); grants de escrita de authenticated = 0.
--
-- NOTA (RD-51): a guarda is_admin() MITIGA o risco (não-admin não lê nada), mas o lint estático
-- auth_users_exposed PERSISTE porque a view ainda referencia auth.users e authenticated mantém SELECT.
-- Para o LINT sair de vez, trocar os joins de auth.users por public.users (que já tem id/email/role) — A3.

CREATE OR REPLACE VIEW public.v_bpo_admin_painel AS
 SELECT c.id AS company_id, COALESCE(c.nome_fantasia, c.razao_social) AS empresa, c.cnpj, c.regime_tributario,
    vcc.plano_v15_nome AS plano, bc.id AS contrato_id, bc.ativo AS contrato_ativo, bc.sla_horas, bc.dia_fechamento, bc.dia_cobranca,
        CASE WHEN bc.contas_pagar THEN 1 ELSE 0 END + CASE WHEN bc.contas_receber THEN 1 ELSE 0 END +
        CASE WHEN bc.conciliacao_bancaria THEN 1 ELSE 0 END + CASE WHEN bc.conciliacao_cartao THEN 1 ELSE 0 END +
        CASE WHEN bc.classificacao_ia THEN 1 ELSE 0 END + CASE WHEN bc.cobranca THEN 1 ELSE 0 END +
        CASE WHEN bc.emissao_boleto THEN 1 ELSE 0 END + CASE WHEN bc.emissao_nfe THEN 1 ELSE 0 END +
        CASE WHEN bc.dre_mensal THEN 1 ELSE 0 END + CASE WHEN bc.relatorio_ia THEN 1 ELSE 0 END +
        CASE WHEN bc.fechamento_mensal THEN 1 ELSE 0 END + CASE WHEN bc.obrigacoes_fiscais THEN 1 ELSE 0 END AS qtd_servicos,
    ( SELECT au.email FROM bpo_companies_assignment a JOIN auth.users au ON au.id = a.user_id WHERE a.company_id = c.id AND a.papel = 'titular'::text AND a.ativo = true LIMIT 1) AS titular_email,
    ( SELECT a.user_id FROM bpo_companies_assignment a WHERE a.company_id = c.id AND a.papel = 'titular'::text AND a.ativo = true LIMIT 1) AS titular_id,
    ( SELECT au.email FROM bpo_companies_assignment a JOIN auth.users au ON au.id = a.user_id WHERE a.company_id = c.id AND a.papel = 'backup'::text AND a.ativo = true LIMIT 1) AS backup_email,
    ( SELECT a.user_id FROM bpo_companies_assignment a WHERE a.company_id = c.id AND a.papel = 'backup'::text AND a.ativo = true LIMIT 1) AS backup_id,
    ( SELECT au.email FROM bpo_companies_assignment a JOIN auth.users au ON au.id = a.user_id WHERE a.company_id = c.id AND a.papel = 'supervisor'::text AND a.ativo = true LIMIT 1) AS supervisor_email,
    ( SELECT a.user_id FROM bpo_companies_assignment a WHERE a.company_id = c.id AND a.papel = 'supervisor'::text AND a.ativo = true LIMIT 1) AS supervisor_id,
    v.completo AS assignment_completo, v.motivos AS assignment_motivos,
    ( SELECT count(*) FROM bpo_inbox_items WHERE bpo_inbox_items.company_id = c.id AND bpo_inbox_items.status = 'pendente'::text) AS inbox_pendente,
    ( SELECT count(*) FROM bpo_inbox_items WHERE bpo_inbox_items.company_id = c.id AND bpo_inbox_items.status = 'pendente'::text AND bpo_inbox_items.sla_vence_em < now()) AS inbox_vencido,
    ( SELECT count(*) FROM bpo_rotinas WHERE bpo_rotinas.company_id = c.id AND bpo_rotinas.ativo = true) AS rotinas_ativas
   FROM companies c JOIN bpo_contratos bc ON bc.company_id = c.id
     LEFT JOIN v_companies_plano_compat vcc ON vcc.company_id = c.id
     CROSS JOIN LATERAL fn_bpo_validar_assignment_completo(c.id) v(completo, tem_titular, tem_backup, tem_supervisor, motivos)
  WHERE bc.ativo = true AND c.is_active = true AND public.is_admin();

CREATE OR REPLACE VIEW public.v_bpo_painel_empresa AS
 SELECT c.id AS company_id, c.nome_fantasia,
    COALESCE(( SELECT pc.nome FROM tenant_subscriptions ts JOIN plan_catalog pc ON pc.id = ts.plan_id WHERE ts.company_id = c.id AND ts.status = 'active'::text AND pc.vertical = 'bpo'::text ORDER BY ts.monthly_price_brl DESC NULLS LAST LIMIT 1), vcc.plano_v15_nome, 'Plano indefinido'::text) AS plano,
    c.regime_tributario,
    count(bii.id) FILTER (WHERE bii.status = 'pendente'::text) AS inbox_pendente,
    count(bii.id) FILTER (WHERE bii.status = 'em_andamento'::text) AS inbox_em_andamento,
    count(bii.id) FILTER (WHERE bii.status = 'aguardando_cliente'::text) AS inbox_aguardando_cliente,
    count(bii.id) FILTER (WHERE bii.status = 'resolvido'::text AND bii.resolvido_em > (now() - '7 days'::interval)) AS resolvidos_7d,
    count(bii.id) FILTER (WHERE (bii.status = ANY (ARRAY['pendente'::text, 'em_andamento'::text])) AND bii.prioridade = 'urgente'::text) AS urgentes,
    count(bii.id) FILTER (WHERE (bii.status = ANY (ARRAY['pendente'::text, 'em_andamento'::text])) AND bii.prioridade = 'alta'::text) AS altos,
    count(bii.id) FILTER (WHERE (bii.status = ANY (ARRAY['pendente'::text, 'em_andamento'::text])) AND bii.sla_vence_em < now()) AS sla_vencido,
    count(bii.id) FILTER (WHERE (bii.status = ANY (ARRAY['pendente'::text, 'em_andamento'::text])) AND bii.sla_vence_em >= now() AND bii.sla_vence_em <= (now() + '04:00:00'::interval)) AS sla_vencendo_4h,
    round(avg(bii.tempo_gasto_segundos::numeric / 60.0) FILTER (WHERE bii.resolvido_em > (now() - '30 days'::interval))) AS tempo_medio_minutos,
    ( SELECT u.email FROM bpo_companies_assignment bca JOIN auth.users u ON u.id = bca.user_id WHERE bca.company_id = c.id AND bca.papel = 'titular'::text AND bca.ativo = true LIMIT 1) AS operador_titular
   FROM companies c JOIN bpo_contratos bc ON bc.company_id = c.id
     LEFT JOIN bpo_inbox_items bii ON bii.company_id = c.id
     LEFT JOIN v_companies_plano_compat vcc ON vcc.company_id = c.id
  WHERE c.is_active = true AND bc.ativo = true AND bc.is_bpo_cliente = true AND public.is_admin()
  GROUP BY c.id, c.nome_fantasia, c.regime_tributario, vcc.plano_v15_nome;

CREATE OR REPLACE VIEW public.v_bpo_performance_operador AS
 SELECT u.id AS user_id, u.email,
    count(DISTINCT bca.company_id) FILTER (WHERE bca.ativo = true) AS empresas_atendidas,
    count(bii.id) FILTER (WHERE bii.status = 'em_andamento'::text) AS itens_em_andamento,
    count(bii.id) FILTER (WHERE bii.resolvido_por = u.id AND bii.resolvido_em > (now() - '7 days'::interval)) AS resolvidos_7d,
    round(avg(bii.tempo_gasto_segundos::numeric / 60.0) FILTER (WHERE bii.resolvido_por = u.id AND bii.resolvido_em > (now() - '30 days'::interval))) AS tempo_medio_minutos,
    round(100.0 * count(bii.id) FILTER (WHERE bii.resolvido_por = u.id AND bii.resolvido_em > (now() - '30 days'::interval) AND bii.resolvido_em <= bii.sla_vence_em)::numeric / NULLIF(count(bii.id) FILTER (WHERE bii.resolvido_por = u.id AND bii.resolvido_em > (now() - '30 days'::interval)), 0)::numeric) AS sla_compliance_pct
   FROM auth.users u
     LEFT JOIN bpo_companies_assignment bca ON bca.user_id = u.id
     LEFT JOIN bpo_inbox_items bii ON bii.assigned_to = u.id OR bii.resolvido_por = u.id
  WHERE public.is_admin()
  GROUP BY u.id, u.email
 HAVING count(DISTINCT bca.company_id) FILTER (WHERE bca.ativo = true) > 0;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.v_bpo_admin_painel, public.v_bpo_painel_empresa, public.v_bpo_performance_operador
  FROM authenticated;

-- ROLLBACK: recriar as 3 views com as defs originais (sem o predicado public.is_admin()) — capturadas via
-- pg_get_viewdef antes de aplicar. Nenhum dado é afetado, só a visibilidade.
