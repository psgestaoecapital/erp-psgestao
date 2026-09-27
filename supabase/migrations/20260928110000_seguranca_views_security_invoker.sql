-- 🚨 SEGURANÇA (CEO 28/09, prioridade 3) · views com direitos do dono mostravam dado de TODAS as empresas a quem
-- está logado. 108 views do public rodavam como o dono (security_invoker desligado): a RLS das tabelas por baixo
-- não valia — um cliente logado lia, p.ex., 14.706 títulos de todas as empresas (v_titulos_consolidados) e 8.142
-- funcionários de compliance de outras empresas. Esta migration liga security_invoker em TODAS: cada view passa a
-- respeitar a RLS das tabelas para quem consulta. service_role e funções SECURITY DEFINER do dono não mudam.
--
-- Antes de ligar, UMA SÓ regra de "empresas do usuário" (decisão do CEO 28/09): get_user_company_ids()
-- (vínculo direto em user_companies + suporte PS: PS_ADMIN/PS_ADMIN_CVM). 91 policies em 67 tabelas (compliance,
-- EPI, contratos, calendário, fiscal, alertas...) ainda liam user_companies direto e 5 usavam user_company_ids()
-- (só vínculo): com a view respeitando a RLS, o suporte PS ficaria sem os dados das empresas que atende.
-- A troca é MECÂNICA dentro de cada policy — o resto da condição (admin, is_global, "false" que trava edição de
-- movimentação de EPI, empregadora/tomadora) fica igual. get_user_company_ids() ⊇ user_companies: ninguém perde
-- acesso; o suporte PS passa a ter o mesmo alcance que já tem no resto do sistema.
-- Ficam como estão (são checagem de PAPEL dentro da empresa, não conjunto de empresas): audit_log_global,
-- rh_remuneracao, rh_importacao_excecao, rh_rv_plano.
-- Ficam DE FORA de propósito (credencial/segredo — só o vínculo direto; o suporte PS usa as funções):
-- erp_certificados_a1 (senha do A1), erp_fiscal_provider_config (tokens Focus/API), compliance_epi_assinatura_tokens
-- (token de assinatura do funcionário). A prova em rollback mostrou o robô PS_ADMIN ganhando as duas primeiras.
--
-- Achados na mesma revisão:
--  · erp_fiscal_webhook_log (payload bruto dos webhooks fiscais de TODAS as empresas, sem company_id) era visível a
--    quem fosse "master/admin" em QUALQUER empresa → só administrador PS.
--  · chamados (sugestoes) — decisão do CEO 28/09: o cliente vê os chamados DA EMPRESA dele, não só os que abriu
--    (Jordana/Fábio/Rodrigo abrem em nome da empresa e outras pessoas acompanham). Leitura por empresa em
--    sugestoes, mensagens, anexos e fotos (storage); escrever/confirmar continua com o autor e o suporte PS.

-- (1) uma só regra de empresas do usuário
DO $$
DECLARE r record; q text; wc text; n int := 0; resto int;
  fora text[] := ARRAY['erp_certificados_a1','erp_fiscal_provider_config','compliance_epi_assinatura_tokens'];
  pa text := '\(\s*SELECT\s+user_companies\.company_id\s+FROM\s+user_companies\s+WHERE\s+\(user_companies\.user_id\s*=\s*auth\.uid\(\)\)\)';
  pb text := '\(\s*SELECT\s+uc\.company_id\s+FROM\s+user_companies\s+uc\s+WHERE\s+\(uc\.user_id\s*=\s*auth\.uid\(\)\)\)';
  pc text := '(^|[^_])user_company_ids\(\)';
  novo text := '( SELECT get_user_company_ids() AS get_user_company_ids)';
BEGIN
  FOR r IN
    SELECT c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) q0, pg_get_expr(p.polwithcheck, p.polrelid) wc0
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relnamespace = 'public'::regnamespace AND NOT (c.relname = ANY (fora))
  LOOP
    q := r.q0; wc := r.wc0;
    IF q IS NOT NULL THEN
      q := regexp_replace(regexp_replace(regexp_replace(q, pa, novo, 'g'), pb, novo, 'g'), pc, '\1get_user_company_ids()', 'g');
    END IF;
    IF wc IS NOT NULL THEN
      wc := regexp_replace(regexp_replace(regexp_replace(wc, pa, novo, 'g'), pb, novo, 'g'), pc, '\1get_user_company_ids()', 'g');
    END IF;
    IF q IS DISTINCT FROM r.q0 THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.polname, r.relname, q);
    END IF;
    IF wc IS DISTINCT FROM r.wc0 THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', r.polname, r.relname, wc);
    END IF;
    IF q IS DISTINCT FROM r.q0 OR wc IS DISTINCT FROM r.wc0 THEN n := n + 1; END IF;
  END LOOP;

  -- nenhuma policy pode sobrar com a regra antiga de conjunto de empresas
  SELECT count(*) INTO resto
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace AND NOT (c.relname = ANY (fora))
     AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
         ~ ('(' || pa || '|' || pb || '|' || pc || ')');
  IF resto > 0 THEN RAISE EXCEPTION 'regra única de empresas: % policies ainda com a regra antiga', resto; END IF;
  RAISE NOTICE 'regra única de empresas: % policies alinhadas a get_user_company_ids()', n;
END $$;

-- (2) webhook fiscal: payload bruto de todas as empresas → só administrador PS
DROP POLICY IF EXISTS webhook_log_master_only ON public.erp_fiscal_webhook_log;
DROP POLICY IF EXISTS webhook_log_admin_ps ON public.erp_fiscal_webhook_log;
CREATE POLICY webhook_log_admin_ps ON public.erp_fiscal_webhook_log FOR SELECT TO authenticated USING (public.is_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.erp_fiscal_webhook_log FROM anon, authenticated;

-- (3) chamados: leitura pela empresa; escrita como antes (autor + suporte PS)
DROP POLICY IF EXISTS sug_rw ON public.sugestoes;
DROP POLICY IF EXISTS sug_select ON public.sugestoes;
DROP POLICY IF EXISTS sug_insert ON public.sugestoes;
DROP POLICY IF EXISTS sug_update ON public.sugestoes;
DROP POLICY IF EXISTS sug_delete ON public.sugestoes;
CREATE POLICY sug_select ON public.sugestoes FOR SELECT TO authenticated
  USING (public.is_admin() OR public.fn_pode_ver_fila_suporte() OR user_id = auth.uid()
         OR company_id IN (SELECT public.get_user_company_ids()));
CREATE POLICY sug_insert ON public.sugestoes FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.fn_pode_ver_fila_suporte() OR user_id = auth.uid());
CREATE POLICY sug_update ON public.sugestoes FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.fn_pode_ver_fila_suporte() OR user_id = auth.uid())
  WITH CHECK (public.is_admin() OR public.fn_pode_ver_fila_suporte() OR user_id = auth.uid());
CREATE POLICY sug_delete ON public.sugestoes FOR DELETE TO authenticated
  USING (public.is_admin() OR public.fn_pode_ver_fila_suporte() OR user_id = auth.uid());

-- mensagens e anexos seguem o chamado (a subconsulta roda com a RLS de sugestoes acima)
DROP POLICY IF EXISTS sugestao_msg_sel ON public.sugestao_mensagem;
CREATE POLICY sugestao_msg_sel ON public.sugestao_mensagem FOR SELECT TO authenticated
  USING (public.fn_pode_ver_fila_suporte()
         OR EXISTS (SELECT 1 FROM public.sugestoes s WHERE s.id = sugestao_mensagem.sugestao_id));

DROP POLICY IF EXISTS sug_anexo_rw ON public.sugestao_anexo;
DROP POLICY IF EXISTS sug_anexo_select ON public.sugestao_anexo;
DROP POLICY IF EXISTS sug_anexo_escrita ON public.sugestao_anexo;
CREATE POLICY sug_anexo_select ON public.sugestao_anexo FOR SELECT TO authenticated
  USING (public.is_admin() OR public.fn_pode_ver_fila_suporte()
         OR EXISTS (SELECT 1 FROM public.sugestoes s WHERE s.id = sugestao_anexo.sugestao_id));
CREATE POLICY sug_anexo_escrita ON public.sugestao_anexo FOR ALL TO authenticated
  USING (public.is_admin() OR public.fn_pode_ver_fila_suporte()
         OR EXISTS (SELECT 1 FROM public.sugestoes s WHERE s.id = sugestao_anexo.sugestao_id AND s.user_id = auth.uid()))
  WITH CHECK (public.is_admin() OR public.fn_pode_ver_fila_suporte()
         OR EXISTS (SELECT 1 FROM public.sugestoes s WHERE s.id = sugestao_anexo.sugestao_id AND s.user_id = auth.uid()));

-- fotos do chamado (bucket privado, pasta = autor): quem vê o anexo vê a foto
DROP POLICY IF EXISTS sug_anexo_select ON storage.objects;
CREATE POLICY sug_anexo_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sugestoes-anexos' AND (
         split_part(name, '/', 1) = (auth.uid())::text OR public.fn_pode_ver_fila_suporte() OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.sugestao_anexo a WHERE a.storage_path = objects.name)));

-- (4) todas as views do schema public passam a respeitar a RLS de quem consulta
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
              AND COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false')
                  NOT IN ('on', 'true')
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v.relname);
  END LOOP;
END $$;
