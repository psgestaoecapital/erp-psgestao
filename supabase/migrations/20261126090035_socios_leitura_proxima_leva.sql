-- Conexão de leitura dos sócios — próxima leva (feedback do Rodrigo, 24/11). TUDO read-only e ADITIVO; nada escreve.
-- A "role de leitura dos sócios" (Level-1: todas as empresas, SÓ leitura, já aprovado pelo CEO) é o papel
-- `supabase_read_only_user` (BYPASSRLS + membro de pg_read_all_data): lê todas as tabelas de todas as empresas, mas
-- NÃO tem auth.uid() (conexão direta, sem JWT) e NÃO tem EXECUTE em funções por padrão.
--
-- PROVA RD-38 (conferida no banco VIVO antes desta migration — não suposto):
--  * Item 3 JÁ ESTAVA RESOLVIDO sem código: has_column_privilege(supabase_read_only_user, <tab>, provider_raw/
--    motivo_rejeicao/mensagem_retorno, 'SELECT') = true em erp_nfe_emitidas, erp_nfse_emitidas, erp_nfe_eventos e
--    erp_gov_nfse_dps (via pg_read_all_data). A role já LÊ o motivo cru direto da tabela — faltava só discoverability.
--    Aqui só enriquecemos o RPC de diagnóstico de nota (fn_diag_nfse) com provider_raw (era o cTribMun na 163).
--  * Item 2: fn_cliente_buscar é SECURITY DEFINER escopada por auth.uid() (is_admin()/get_user_company_ids()), NÃO por
--    p_company_id — a role de leitura (sem JWT) receberia "Sem acesso" mesmo com GRANT EXECUTE (grant seria no-op útil).
--    Já fn_lancamentos_buscar é escopada SÓ por p_company_id (sem auth.uid), read-only -> GRANT direto resolve.
--    Então, auditado função a função: GRANT em fn_lancamentos_buscar (título) + wrapper novo fn_diag_cliente_buscar
--    (cliente), escopado SÓ pelo parâmetro, SECURITY INVOKER (sem elevação; a role já lê tudo), liberado só p/ a role
--    de leitura + service_role (NUNCA authenticated — seria furo: usuário comum passaria company_id arbitrário).
--  * Item 4 é só guidance (bug de front não aparece no dado) — vai no corpo da PR, sem código.

-- ===================== Item 1: status de entrega/deploy por PR ou chamado (read-only) =====================
-- Fontes vivas conferidas: erp_dev_entrega(pr_numero,code,evento∈{aberta,pronta,publicada,fechada},via,sha,url,
-- ocorrido_em); erp_agente_mensagem(pr_numero,chamado_numero) liga chamado<->PR; supabase_migrations.schema_migrations
-- (version,name) = ledger "no ar". NÃO existe no banco um vínculo PR->migration (isso mora no GitHub); por honestidade
-- RD-38 devolvemos o ledger (última versão aplicada + as 10 últimas) como contexto, sem inventar o mapeamento.
CREATE OR REPLACE FUNCTION public.fn_status_entrega_pr(p_pr integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'pr_numero', p_pr,
    'encontrado', EXISTS (SELECT 1 FROM erp_dev_entrega e WHERE e.pr_numero = p_pr),
    'code', (SELECT e.code FROM erp_dev_entrega e WHERE e.pr_numero = p_pr ORDER BY e.ocorrido_em DESC NULLS LAST LIMIT 1),
    'ultimo_evento', (SELECT e.evento FROM erp_dev_entrega e WHERE e.pr_numero = p_pr ORDER BY e.ocorrido_em DESC NULLS LAST LIMIT 1),
    'ultimo_em', (SELECT e.ocorrido_em FROM erp_dev_entrega e WHERE e.pr_numero = p_pr ORDER BY e.ocorrido_em DESC NULLS LAST LIMIT 1),
    'publicado', EXISTS (SELECT 1 FROM erp_dev_entrega e WHERE e.pr_numero = p_pr AND e.evento = 'publicada'),
    'publicado_em', (SELECT max(e.ocorrido_em) FROM erp_dev_entrega e WHERE e.pr_numero = p_pr AND e.evento = 'publicada'),
    'pronta', EXISTS (SELECT 1 FROM erp_dev_entrega e WHERE e.pr_numero = p_pr AND e.evento = 'pronta'),
    'fechada', EXISTS (SELECT 1 FROM erp_dev_entrega e WHERE e.pr_numero = p_pr AND e.evento = 'fechada'),
    'entregas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'evento', e.evento, 'code', e.code, 'via', e.via, 'sha', e.sha, 'url', e.url,
          'titulo', e.titulo, 'ocorrido_em', e.ocorrido_em)
        ORDER BY e.ocorrido_em DESC NULLS LAST)
      FROM erp_dev_entrega e WHERE e.pr_numero = p_pr), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.fn_status_entrega_pr(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_status_entrega_pr(integer) TO supabase_read_only_user, service_role;

CREATE OR REPLACE FUNCTION public.fn_status_entrega(p_chamado integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'chamado', p_chamado,
    'prs', COALESCE((
      SELECT jsonb_agg(public.fn_status_entrega_pr(q.pr) ORDER BY q.pr)
      FROM (SELECT DISTINCT m.pr_numero AS pr FROM erp_agente_mensagem m
             WHERE m.chamado_numero = p_chamado AND m.pr_numero IS NOT NULL) q), '[]'::jsonb),
    'ledger', jsonb_build_object(
      'ultima_versao', (SELECT s.version FROM supabase_migrations.schema_migrations s ORDER BY s.version DESC LIMIT 1),
      'ultima_nome',   (SELECT s.name    FROM supabase_migrations.schema_migrations s ORDER BY s.version DESC LIMIT 1),
      'total',         (SELECT count(*)  FROM supabase_migrations.schema_migrations),
      'ultimas', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', u.version, 'name', u.name) ORDER BY u.version DESC)
                  FROM (SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10) u), '[]'::jsonb)),
    'nota', 'O vínculo exato PR->migration mora no GitHub (não no banco); "ledger" mostra o que já está aplicado em produção.'
  );
$$;
REVOKE ALL ON FUNCTION public.fn_status_entrega(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_status_entrega(integer) TO supabase_read_only_user, service_role;

-- ===================== Item 2: allowlist read-only p/ a conexão de leitura (auditada função a função) =====================
-- (a) TÍTULO — fn_lancamentos_buscar já é escopada SÓ por p_company_id (sem auth.uid), STABLE, 100% read-only
--     (conferido no corpo vivo: só SELECT em erp_pagar/erp_receber + LEFT JOIN cadastros). GRANT direto resolve.
GRANT EXECUTE ON FUNCTION public.fn_lancamentos_buscar(uuid,text,text,date,date,text,text,uuid,uuid,integer,integer)
  TO supabase_read_only_user;

-- (b) CLIENTE — fn_cliente_buscar original é gated por auth.uid (inútil p/ a role de leitura). Wrapper read-only
--     escopado SÓ pelo parâmetro p_company_id, SECURITY INVOKER, mesma lógica de busca (nome/razão/CNPJ-CPF).
CREATE OR REPLACE FUNCTION public.fn_diag_cliente_buscar(p_company_id uuid, p_termo text, p_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE v_termo text := btrim(coalesce(p_termo,'')); v_dig text; v_out jsonb;
BEGIN
  -- Level-1: escopo é o PARÂMETRO p_company_id (a role de leitura não tem auth.uid). SECURITY INVOKER: roda com os
  -- privilégios de quem chama; só supabase_read_only_user (bypassrls+pg_read_all_data) e service_role têm EXECUTE.
  -- Qualquer outro papel (sem bypassrls) seria filtrado por RLS. 100% read-only (só SELECT).
  IF length(v_termo) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'resultados', '[]'::jsonb);
  END IF;
  v_dig := NULLIF(regexp_replace(v_termo, '\D', '', 'g'), '');
  SELECT jsonb_agg(j) INTO v_out FROM (
    SELECT jsonb_build_object(
      'cliente_id', c.id,
      'nome', COALESCE(NULLIF(btrim(c.nome_fantasia),''), NULLIF(btrim(c.razao_social),''), '—'),
      'cnpj_cpf', COALESCE(NULLIF(btrim(c.cnpj_cpf),''), NULLIF(btrim(c.cpf_cnpj),'')),
      'cidade', c.cidade
    ) AS j
    FROM erp_clientes c
    WHERE c.company_id = p_company_id AND COALESCE(c.ativo, true)
      AND ( c.nome_fantasia ILIKE '%'||v_termo||'%'
         OR c.razao_social ILIKE '%'||v_termo||'%'
         OR (v_dig IS NOT NULL AND regexp_replace(COALESCE(c.cnpj_cpf, c.cpf_cnpj, ''), '\D', '', 'g') ILIKE '%'||v_dig||'%') )
    ORDER BY COALESCE(NULLIF(btrim(c.nome_fantasia),''), NULLIF(btrim(c.razao_social),''), '')
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit,10), 50))
  ) t;
  RETURN jsonb_build_object('ok', true, 'resultados', COALESCE(v_out, '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.fn_diag_cliente_buscar(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_diag_cliente_buscar(uuid,text,integer) TO supabase_read_only_user, service_role;

-- ===================== Item 3: provider_raw (motivo cru do provedor) no RPC de diagnóstico de nota =====================
-- A role de leitura JÁ lê provider_raw direto da tabela (pg_read_all_data) — aqui expomos no RPC do Canal PS
-- (fn_diag_nfse, path autenticado dos sócios via porteiro) para o motivo CRU vir junto do amigável. Só adiciona campo.
CREATE OR REPLACE FUNCTION public.fn_diag_nfse(p_company_id uuid, p_limite integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.fn__diagnostico_socio_pode() THEN RAISE EXCEPTION 'Sem permissão para diagnóstico' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'numero', numero, 'serie', serie, 'status', status, 'data', data_emissao,
      'codigo_servico', codigo_servico, 'motivo_rejeicao', motivo_rejeicao,
      'provider', provider, 'provider_raw', provider_raw)
      ORDER BY coalesce(data_emissao, criado_em) DESC), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT * FROM public.erp_nfse_emitidas WHERE company_id = p_company_id
      ORDER BY coalesce(data_emissao, criado_em) DESC LIMIT least(greatest(coalesce(p_limite,30),1),200)) s;
  RETURN jsonb_build_object('ok', true, 'dados', v_rows);
END; $$;
REVOKE ALL ON FUNCTION public.fn_diag_nfse(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_diag_nfse(uuid,integer) TO authenticated, service_role;
