-- feat(consultor-ia): camada semântica + consulta segura por empresa (PR A).
-- O Consultor IA vira um AGENTE ANALISTA: consulta o banco DAQUELA empresa como o Eng. Chefe faria. Para isso, uma
-- camada semântica (schema consultor) com views amigáveis e seguras, e uma RPC que executa SELECT livre do modelo com
-- 5 travas (parser no Node = T1 em src/lib/consultor/sqlGuard.ts; as travas de banco são T2..T5 aqui).
--
-- SEGURANÇA (defesa em profundidade):
--  - papel consultor_leitor (NOLOGIN, NOINHERIT): só USAGE no schema consultor e SELECT nas views; NENHUM acesso ao
--    schema public (não lê erp_*), nenhum DML, nenhuma função de escrita;
--  - a RPC public.fn_consultor_sql é SECURITY DEFINER com DONO = consultor_leitor → o SELECT do modelo roda com ESSE
--    papel mínimo (2ª trava, além do parser);
--  - amarração por transação: fn_consultor_sql valida auth.uid() × empresa e grava (txid, company_id) em
--    consultor.sessao; TODAS as views filtram company_id = empresa amarrada ao txid. Sem vínculo → 0 linhas;
--  - statement_timeout 5s + LIMIT 200 + jsonb_agg; log em consultor_ia_consulta;
--  - NUNCA expõe: token/chave/senha/cartão, agência/conta completas, CPF de pessoa física aberto, salário individual.

-- ───────────────────────── schema + papel de leitura ─────────────────────────
CREATE SCHEMA IF NOT EXISTS consultor;
REVOKE ALL ON SCHEMA consultor FROM PUBLIC;

DO $$ BEGIN
  CREATE ROLE consultor_leitor WITH NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- NB: NÃO fazer ALTER ROLE ... NOSUPERUSER aqui — o papel do deploy (postgres, não-superusuário em Supabase
-- gerenciado) não pode mexer no atributo SUPERUSER de nenhum papel (SQLSTATE 42501), e CREATE ROLE já nasce
-- NOSUPERUSER. Isso quebrava o deploy-migrations (run #4782).
-- Permite ao papel do deploy ASSUMIR consultor_leitor (necessário para o "ALTER FUNCTION ... OWNER TO
-- consultor_leitor" lá embaixo: trocar o dono exige poder SET ROLE o novo dono). postgres tem ADMIN no papel que criou.
DO $$ BEGIN
  EXECUTE format('GRANT consultor_leitor TO %I', current_user);
EXCEPTION WHEN OTHERS THEN NULL; END $$;
GRANT USAGE ON SCHEMA consultor TO consultor_leitor;
-- USAGE em auth só para resolver auth.uid() (função já é PUBLIC EXECUTE); não dá acesso a nenhuma tabela de auth.
GRANT USAGE ON SCHEMA auth TO consultor_leitor;
-- o papel NÃO tem USAGE em public: não alcança erp_* nem funções de public (só pg_catalog, limitado pelo timeout).

-- ───────────────────────── amarração empresa × transação ─────────────────────────
CREATE TABLE IF NOT EXISTS consultor.sessao (
  txid        bigint PRIMARY KEY,
  company_id  uuid NOT NULL,
  user_id     uuid,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE consultor.sessao FROM PUBLIC;

-- fn_bind: DONA = postgres (SECURITY DEFINER). Grava (txid_current, company_id) e RECUSA um 2º vínculo com empresa
-- diferente no mesmo txid (impede trocar de empresa no meio da transação). Idempotente p/ a mesma empresa.
CREATE OR REPLACE FUNCTION consultor.fn_bind(p_company_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = consultor, pg_catalog AS $$
DECLARE v_existe uuid;
BEGIN
  SELECT company_id INTO v_existe FROM consultor.sessao WHERE txid = txid_current();
  IF v_existe IS NOT NULL THEN
    IF v_existe <> p_company_id THEN
      RAISE EXCEPTION 'consultor: empresa já amarrada a esta transação' USING errcode = '42501';
    END IF;
    RETURN;
  END IF;
  INSERT INTO consultor.sessao (txid, company_id, user_id)
  VALUES (txid_current(), p_company_id, auth.uid())
  ON CONFLICT (txid) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION consultor.fn_bind(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consultor.fn_bind(uuid) TO consultor_leitor;

-- empresa amarrada ao txid (usada por TODAS as views). STABLE; dona = postgres.
CREATE OR REPLACE FUNCTION consultor.empresa_atual()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = consultor, pg_catalog AS $$
  SELECT company_id FROM consultor.sessao WHERE txid = txid_current()
$$;
REVOKE ALL ON FUNCTION consultor.empresa_atual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consultor.empresa_atual() TO consultor_leitor;

-- ───────────────────────── log de consultas (T5) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.consultor_ia_consulta (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  user_id     uuid,
  pergunta_id uuid,
  sql         text,
  linhas      int,
  ms          int,
  erro        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consultor_ia_consulta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.consultor_ia_consulta FROM PUBLIC, anon;
DROP POLICY IF EXISTS consultor_ia_consulta_sel ON public.consultor_ia_consulta;
CREATE POLICY consultor_ia_consulta_sel ON public.consultor_ia_consulta FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.consultor_ia_consulta TO authenticated;
-- retenção 180 dias (limpeza oportunista por uma função; cron existente pode chamar)
CREATE OR REPLACE FUNCTION public.fn_consultor_log_retencao()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM public.consultor_ia_consulta WHERE created_at < now() - interval '180 days' RETURNING 1)
  SELECT count(*)::int FROM d
$$;
REVOKE ALL ON FUNCTION public.fn_consultor_log_retencao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_log_retencao() TO service_role;

-- fn_log: DONA = postgres. Grava no log com a empresa amarrada ao txid (não aceita company arbitrária do chamador).
CREATE OR REPLACE FUNCTION consultor.fn_log(p_sql text, p_linhas int, p_ms int, p_erro text, p_pergunta_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = consultor, public, pg_catalog AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM consultor.sessao WHERE txid = txid_current();
  IF v_co IS NULL THEN RETURN; END IF;
  INSERT INTO public.consultor_ia_consulta (company_id, user_id, pergunta_id, sql, linhas, ms, erro)
  VALUES (v_co, auth.uid(), p_pergunta_id, left(p_sql, 8000), p_linhas, p_ms, left(p_erro, 2000));
END; $$;
REVOKE ALL ON FUNCTION consultor.fn_log(text, int, int, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consultor.fn_log(text, int, int, text, uuid) TO consultor_leitor;

-- ───────────────────────── camada semântica (views donas = postgres, security_barrier, filtradas pela sessão) ─────────────────────────
-- mascaramento de CPF de pessoa física (nunca aberto)
CREATE OR REPLACE FUNCTION consultor.mask_doc(p_doc text, p_tipo_pessoa text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN p_doc IS NULL THEN NULL
    WHEN length(regexp_replace(p_doc, '\D', '', 'g')) = 11 OR lower(coalesce(p_tipo_pessoa,'')) IN ('fisica','física','pf','pessoa_fisica')
      THEN '***.***.***-' || right(regexp_replace(p_doc, '\D', '', 'g'), 2)
    ELSE p_doc END
$$;
REVOKE ALL ON FUNCTION consultor.mask_doc(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consultor.mask_doc(text, text) TO consultor_leitor;

-- títulos (receber + pagar unificados)
CREATE OR REPLACE VIEW consultor.titulos WITH (security_barrier = true) AS
  SELECT 'receber'::text AS tipo, r.id, r.company_id, r.cliente_nome AS parceiro, r.descricao AS documento,
         r.data_emissao AS emissao, r.data_vencimento AS vencimento, r.data_pagamento AS pagamento,
         r.valor, COALESCE(r.juros,0) AS juros, COALESCE(r.multa,0) AS multa, COALESCE(r.desconto,0) AS desconto,
         COALESCE(r.valor_pago,0) AS valor_pago,
         round(r.valor + COALESCE(r.juros,0) + COALESCE(r.multa,0) - COALESCE(r.desconto,0) - COALESCE(r.valor_pago,0), 2) AS saldo,
         r.status, r.conciliado, r.origem_baixa, r.boleto_status, r.categoria, r.centro_custo_id, r.conta_bancaria_id,
         '/dashboard/financeiro/receber?id=' || r.id AS link
    FROM public.erp_receber r
   WHERE r.deleted_at IS NULL AND r.company_id = consultor.empresa_atual()
  UNION ALL
  SELECT 'pagar'::text, p.id, p.company_id, p.fornecedor_nome, p.descricao,
         p.data_emissao, p.data_vencimento, p.data_pagamento,
         p.valor, COALESCE(p.juros,0), COALESCE(p.multa,0), COALESCE(p.desconto,0), COALESCE(p.valor_pago,0),
         round(p.valor + COALESCE(p.juros,0) + COALESCE(p.multa,0) - COALESCE(p.desconto,0) - COALESCE(p.valor_pago,0), 2),
         p.status, p.conciliado, p.origem_baixa, NULL::text, p.categoria, p.centro_custo_id, NULL::uuid,
         '/dashboard/financeiro/pagar?id=' || p.id
    FROM public.erp_pagar p
   WHERE p.deleted_at IS NULL AND p.company_id = consultor.empresa_atual();

-- baixas (pagamentos individuais)
CREATE OR REPLACE VIEW consultor.baixas WITH (security_barrier = true) AS
  SELECT 'receber'::text AS tipo, b.id, b.company_id, b.receber_id AS titulo_id, b.valor, b.data, b.forma, b.origem, b.movimento_banco_id
    FROM public.erp_receber_baixa b WHERE b.deleted_at IS NULL AND b.company_id = consultor.empresa_atual()
  UNION ALL
  SELECT 'pagar'::text, b.id, b.company_id, b.pagar_id, b.valor, b.data, b.forma, b.origem, b.movimento_banco_id
    FROM public.erp_pagar_baixa b WHERE b.deleted_at IS NULL AND b.company_id = consultor.empresa_atual();

-- boletos (do erp_receber)
CREATE OR REPLACE VIEW consultor.boletos WITH (security_barrier = true) AS
  SELECT r.id AS titulo_id, r.company_id, r.boleto_banco_codigo AS banco_codigo, r.boleto_nosso_numero AS nosso_numero,
         r.boleto_status AS situacao, r.boleto_emitido_em AS emitido_em, r.boleto_pago_em AS pago_em,
         r.valor, COALESCE(r.valor_pago,0) AS valor_pago, r.status AS status_titulo
    FROM public.erp_receber r
   WHERE r.deleted_at IS NULL AND r.boleto_nosso_numero IS NOT NULL AND r.company_id = consultor.empresa_atual();

-- extrato (movimentos do banco)
CREATE OR REPLACE VIEW consultor.extrato WITH (security_barrier = true) AS
  SELECT m.id, m.company_id, m.data_transacao AS data, m.descricao_normalizada AS descricao, m.valor,
         CASE WHEN m.valor >= 0 THEN 'credito' ELSE 'debito' END AS natureza,
         m.status, m.lancamento_tabela, m.lancamento_id, m.match_origem
    FROM public.conciliacao_movimento m
   WHERE m.company_id = consultor.empresa_atual();

-- vínculos da conciliação (movimento × títulos)
CREATE OR REPLACE VIEW consultor.conciliacao_vinculos WITH (security_barrier = true) AS
  SELECT v.id, v.company_id, v.movimento_id, v.lancamento_tabela, v.lancamento_id, v.valor_vinculado,
         v.ajuste_juros_antes, v.ajuste_desconto_antes, v.ajuste_valor_pago_antes
    FROM public.conciliacao_vinculo v
   WHERE v.company_id = consultor.empresa_atual();

-- contas bancárias (sem agência/conta completas)
CREATE OR REPLACE VIEW consultor.contas_bancarias WITH (security_barrier = true) AS
  SELECT c.id, c.company_id, c.nome, c.banco, c.banco_codigo,
         CASE WHEN c.conta IS NULL THEN NULL ELSE '****' || right(regexp_replace(c.conta,'\D','','g'), 2) END AS conta_final,
         c.tipo_conta, c.saldo_atual AS saldo_sistema, c.saldo_extrato, c.saldo_extrato_em, c.ativo, c.principal
    FROM public.erp_banco_contas c
   WHERE c.company_id = consultor.empresa_atual();

-- parceiros (clientes + fornecedores; CPF de PF mascarado; sem dados bancários)
CREATE OR REPLACE VIEW consultor.parceiros WITH (security_barrier = true) AS
  SELECT 'cliente'::text AS papel, cl.id, cl.company_id,
         COALESCE(NULLIF(cl.nome_fantasia,''), cl.razao_social) AS nome, cl.cidade, cl.uf, cl.tipo_pessoa,
         consultor.mask_doc(COALESCE(cl.cpf_cnpj, cl.cnpj_cpf), cl.tipo_pessoa) AS documento,
         cl.score_inadimplencia, cl.qtd_atrasos, cl.dias_medio_atraso, cl.ativo
    FROM public.erp_clientes cl
   WHERE cl.excluido_em IS NULL AND cl.company_id = consultor.empresa_atual()
  UNION ALL
  SELECT 'fornecedor'::text, f.id, f.company_id,
         COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social), f.cidade, f.uf, f.tipo_pessoa,
         consultor.mask_doc(COALESCE(f.cpf_cnpj, f.cnpj_cpf), f.tipo_pessoa),
         NULL::numeric, NULL::int, NULL::numeric, f.ativo
    FROM public.erp_fornecedores f
   WHERE f.excluido_em IS NULL AND f.company_id = consultor.empresa_atual();

-- categorias / plano de contas
CREATE OR REPLACE VIEW consultor.categorias WITH (security_barrier = true) AS
  SELECT c.id, c.company_id, c.nome, c.tipo, c.grupo, c.dre_grupo, c.ativo
    FROM public.erp_categorias c WHERE c.company_id = consultor.empresa_atual();

-- centros de custo
CREATE OR REPLACE VIEW consultor.centros_custo WITH (security_barrier = true) AS
  SELECT cc.id, cc.company_id, cc.nome, cc.codigo, cc.responsavel, cc.ativo
    FROM public.erp_centros_custo cc WHERE cc.company_id = consultor.empresa_atual();

-- contratos (sem observações internas / dados de contato sensíveis além do necessário)
CREATE OR REPLACE VIEW consultor.contratos WITH (security_barrier = true) AS
  SELECT ct.id, ct.company_id, ct.numero, ct.nome, ct.cliente_nome AS cliente, ct.tipo, ct.status,
         ct.valor_mensal, ct.valor_atual, ct.data_inicio, ct.data_fim, ct.periodicidade,
         ct.total_faturado, ct.total_titulos_gerados, '/dashboard/contratos?id=' || ct.id AS link
    FROM public.erp_contratos ct
   WHERE ct.excluido_em IS NULL AND ct.company_id = consultor.empresa_atual();

-- histórico do título (audit_log_global) — OBRIGATÓRIO filtrar company_id + janela de 120 dias (tabela de 25 GB).
-- "quem" = só o login antes do @; ação em linguagem do usuário (CRIOU/ALTEROU/EXCLUIU).
CREATE OR REPLACE VIEW consultor.historico_titulo WITH (security_barrier = true) AS
  SELECT a.id, a.company_id, a.tabela, a.registro_id AS titulo_id, a.created_at AS quando,
         split_part(COALESCE(a.user_email,''), '@', 1) AS quem,
         CASE lower(a.acao) WHEN 'insert' THEN 'CRIOU' WHEN 'update' THEN 'ALTEROU' WHEN 'delete' THEN 'EXCLUIU'
              ELSE upper(a.acao) END AS acao,
         a.valor_anterior, a.valor_novo
    FROM public.audit_log_global a
   WHERE a.tabela IN ('erp_receber','erp_pagar')
     AND a.company_id = consultor.empresa_atual()
     AND a.created_at >= now() - interval '120 days';

-- dicionário de dados (uma linha por coluna; vai no system prompt, cacheado). Sem filtro de empresa (metadados).
CREATE TABLE IF NOT EXISTS consultor.dicionario (
  relacao     text NOT NULL,
  coluna      text NOT NULL,
  descricao   text NOT NULL,
  PRIMARY KEY (relacao, coluna)
);
CREATE OR REPLACE VIEW consultor.dicionario_view WITH (security_barrier = true) AS
  SELECT relacao, coluna, descricao FROM consultor.dicionario;

-- grants: consultor_leitor só LÊ as views (nenhuma tabela base)
GRANT SELECT ON consultor.titulos, consultor.baixas, consultor.boletos, consultor.extrato,
  consultor.conciliacao_vinculos, consultor.contas_bancarias, consultor.parceiros, consultor.categorias,
  consultor.centros_custo, consultor.contratos, consultor.historico_titulo, consultor.dicionario_view
  TO consultor_leitor;

-- ───────────────────────── RPC de execução (T2..T5) ─────────────────────────
-- DONA = consultor_leitor (SECURITY DEFINER) → o SELECT do modelo roda com o papel mínimo. Valida acesso, amarra a
-- empresa, roda com timeout curto, embrulha em jsonb_agg com LIMIT 200 e registra no log.
CREATE OR REPLACE FUNCTION public.fn_consultor_sql(p_company_id uuid, p_sql text, p_pergunta_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = consultor, pg_catalog AS $$
DECLARE v_res jsonb; v_rows int; v_ini timestamptz := clock_timestamp(); v_ms int; v_sql text;
BEGIN
  IF auth.uid() IS NULL AND coalesce(current_setting('request.jwt.claims', true),'') <> '' THEN
    RAISE EXCEPTION 'consultor: sessão sem usuário' USING errcode = '42501';
  END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'consultor: sem acesso a esta empresa' USING errcode = '42501';
  END IF;
  IF p_sql IS NULL OR btrim(p_sql) = '' THEN RETURN '[]'::jsonb; END IF;

  -- GUARDA DE INJEÇÃO no BANCO (auditoria #6221 · 2ª linha, além do parser do Node): o EXECUTE de plpgsql aceita
  -- MÚLTIPLOS comandos — um p_sql como "x ) AS _q ) AS t; <comando>; SELECT ... ( y" roda o 2º comando. Como a RPC é
  -- chamável por qualquer authenticated direto no PostgREST (sem o parser do Node) e roda como consultor_leitor (dono),
  -- barramos no banco: recusa ';' (menos um único final, removido), '--' e '/*'; exige começar com SELECT/WITH.
  v_sql := btrim(p_sql);
  IF right(v_sql, 1) = ';' THEN v_sql := btrim(left(v_sql, length(v_sql) - 1)); END IF;
  IF strpos(v_sql, ';') > 0 OR strpos(v_sql, '--') > 0 OR strpos(v_sql, '/*') > 0 THEN
    RAISE EXCEPTION 'consultor: consulta inválida (um único SELECT, sem ";" ou comentários)' USING errcode = '42501';
  END IF;
  IF v_sql !~* '^(select|with)\s' THEN
    RAISE EXCEPTION 'consultor: só SELECT/WITH' USING errcode = '42501';
  END IF;

  PERFORM consultor.fn_bind(p_company_id);        -- amarra empresa × txid
  -- Teto de tempo: o cap EFETIVO é o statement_timeout do papel chamador, armado no início do comando de TOPO
  -- (PostgREST roda como authenticated = 8s, anon = 3s; anon nem tem EXECUTE aqui). Um SET aqui dentro NÃO re-arma o
  -- timer do comando em curso, então o pg_sleep/consulta cara do modelo é cortada pelo teto do papel — nunca derruba
  -- o banco. O parser no Node (T1) ainda barra pg_sleep/funções voláteis antes de chegar aqui. SET LOCAL mantido como
  -- intenção/segunda linha (vale para eventuais comandos futuros na mesma transação).
  SET LOCAL statement_timeout = '5s';
  BEGIN
    EXECUTE format('SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM ( SELECT * FROM ( %s ) AS _q LIMIT 200 ) AS t', v_sql)
      INTO v_res;
  EXCEPTION WHEN OTHERS THEN
    v_ms := (extract(epoch FROM (clock_timestamp() - v_ini)) * 1000)::int;
    PERFORM consultor.fn_log(p_sql, NULL, v_ms, SQLERRM, p_pergunta_id);
    RETURN jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE);
  END;
  v_rows := jsonb_array_length(COALESCE(v_res, '[]'::jsonb));
  v_ms := (extract(epoch FROM (clock_timestamp() - v_ini)) * 1000)::int;
  PERFORM consultor.fn_log(p_sql, v_rows, v_ms, NULL, p_pergunta_id);
  RETURN jsonb_build_object('linhas', v_rows, 'truncado', (v_rows >= 200), 'ms', v_ms, 'dados', COALESCE(v_res, '[]'::jsonb));
END; $$;
-- DONO = consultor_leitor: o corpo todo (inclusive o SELECT do modelo) roda no papel mínimo (SECURITY DEFINER), sem
-- acesso a public. SET LOCAL ROLE não serve (é proibido dentro de SECURITY DEFINER), por isso a confinação é pela POSSE.
-- O ALTER ... OWNER exige: (1) o papel do deploy poder SET ROLE o novo dono — garantido pelo GRANT consultor_leitor TO
-- current_user lá em cima; e (2) o novo dono ter CREATE no schema da função (public). O consultor_leitor NÃO pode ter
-- CREATE em public de forma permanente (segurança), então damos CREATE só para a troca e revogamos em seguida — a POSSE
-- fica; o papel segue sem CREATE e sem acesso a public. (Foi o passo 2 que faltava e quebrava o deploy-migrations.)
GRANT CREATE ON SCHEMA public TO consultor_leitor;
ALTER FUNCTION public.fn_consultor_sql(uuid, text, uuid) OWNER TO consultor_leitor;
REVOKE CREATE ON SCHEMA public FROM consultor_leitor;
REVOKE ALL ON FUNCTION public.fn_consultor_sql(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_sql(uuid, text, uuid) TO authenticated, service_role;
-- fn_consultor_sql roda COMO consultor_leitor (definer): precisa validar acesso pelas funções de empresa (não têm
-- EXECUTE p/ PUBLIC). São só leitura do JWT atual — o papel não consegue forjar empresa.
GRANT EXECUTE ON FUNCTION public.get_user_company_ids() TO consultor_leitor;
GRANT EXECUTE ON FUNCTION public.is_admin() TO consultor_leitor;

-- semente do dicionário (idempotente)
INSERT INTO consultor.dicionario (relacao, coluna, descricao) VALUES
 ('titulos','tipo','receber (cliente deve à empresa) ou pagar (a empresa deve)'),
 ('titulos','parceiro','nome do cliente (receber) ou fornecedor (pagar)'),
 ('titulos','valor','valor original do título'),
 ('titulos','juros','juros/encargos por atraso somados no recebimento/pagamento'),
 ('titulos','desconto','desconto concedido'),
 ('titulos','valor_pago','quanto já foi efetivamente recebido/pago (soma das baixas)'),
 ('titulos','saldo','quanto ainda falta (valor+juros+multa-desconto-valor_pago)'),
 ('titulos','status','aberto, vencido, parcial, pago, cancelado...'),
 ('titulos','conciliado','se o título já foi casado com um movimento do extrato bancário'),
 ('titulos','link','caminho da tela para abrir o título'),
 ('baixas','titulo_id','o título (receber_id/pagar_id) a que a baixa pertence'),
 ('baixas','origem','como a baixa foi feita: boleto, conciliacao, manual, trigger_guarda...'),
 ('boletos','nosso_numero','identificador do boleto no banco'),
 ('boletos','situacao','situação do boleto: registrado, liquidado...'),
 ('extrato','valor','valor do movimento no extrato (positivo = crédito, negativo = débito)'),
 ('extrato','status','pendente, conciliado, ignorado'),
 ('conciliacao_vinculos','valor_vinculado','parte do movimento atribuída a cada título na conciliação agrupada'),
 ('contas_bancarias','saldo_sistema','saldo calculado pelo sistema (baixas)'),
 ('contas_bancarias','saldo_extrato','saldo informado pelo extrato bancário'),
 ('parceiros','documento','CNPJ da empresa; CPF de pessoa física aparece MASCARADO'),
 ('parceiros','score_inadimplencia','quanto maior, mais risco de atraso (clientes)'),
 ('contratos','valor_mensal','valor recorrente do contrato'),
 ('historico_titulo','quem','quem alterou (login, sem o domínio do e-mail)'),
 ('historico_titulo','acao','CRIOU, ALTEROU ou EXCLUIU'),
 ('historico_titulo','valor_anterior','estado do registro antes da alteração'),
 ('historico_titulo','valor_novo','estado do registro depois da alteração')
ON CONFLICT (relacao, coluna) DO UPDATE SET descricao = EXCLUDED.descricao;
