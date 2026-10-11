-- Central de Desenvolvimento · aba "Codes" em TEMPO REAL (CEO 07/10 14:30). Faixa de migration 60 (Eng. Chefe, RD-80).
-- Por Code: o que está sendo trabalhado AGORA (lease + mensagem em andamento), o que foi ENTREGUE (PR publicada, com
-- hora e link) e o que está na FILA (mensagens novas). Visível só para a equipe PS — inclusive no Realtime.
--
-- 1) fn_dev_painel_pode_ver(): quem é "equipe PS" para o painel = SOMENTE membro ATIVO de ps_equipe_acesso
--    (fn_equipe_ps_ativa). Sem is_admin(): ele olha users.role (adm/acesso_total), que usuário de cliente pode ter (CEO 07/10).
-- 2) erp_dev_entrega (NOVA): eventos das PRs (aberta|pronta|publicada|fechada), gravados pelo workflow
--    registrar-entrega.yml com a service_role. Único por (pr_numero, evento, sha). RLS: SELECT só da equipe PS;
--    INSERT/UPDATE só service_role; nada ao anon (RD-79).
-- 3) Leitura das tabelas da caixa dos agentes pela equipe PS (decisão do CEO 07/10): erp_agente_mensagem (SÓ as colunas
--    que o painel mostra — corpo/acionamento continuam fechados), erp_agente_sessao_lease e erp_agente_rotina. Escrita
--    continua só pela service_role (canal protegido: as funções da caixa seguem revogadas de anon/authenticated).
-- 4) Realtime: as 3 tabelas na publicação supabase_realtime. O Realtime aplica a RLS e o privilégio de coluna do
--    usuário que assina (realtime.apply_rls) → só a equipe PS recebe os eventos.
-- 5) system_screens (RD-50): rota /dashboard/dev/codes.

-- ── 1) quem vê o painel ──────────────────────────────────────────────────────────────────────────────────────────
-- ps_equipe_acesso tem RLS própria (só PS_ADMIN lê): as policies consultam por função SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.fn_equipe_ps_ativa() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM ps_equipe_acesso e WHERE e.user_id = auth.uid() AND e.ativo)
$function$;
REVOKE ALL ON FUNCTION public.fn_equipe_ps_ativa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_equipe_ps_ativa() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_equipe_ps_ativa() IS
  'Equipe PS = membro ATIVO de ps_equipe_acesso (nunca users.role, que usuário de cliente pode ter). Base das policies da equipe PS.';

CREATE OR REPLACE FUNCTION public.fn_dev_painel_pode_ver() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT public.fn_equipe_ps_ativa()
$function$;
REVOKE ALL ON FUNCTION public.fn_dev_painel_pode_ver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_painel_pode_ver() TO authenticated, service_role;
COMMENT ON FUNCTION public.fn_dev_painel_pode_ver() IS
  'Equipe PS para a aba Codes da Central de Desenvolvimento: SOMENTE ps_equipe_acesso ativo (fn_equipe_ps_ativa). Usada nas policies e na tela.';

-- ── 2) erp_dev_entrega ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_dev_entrega (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pr_numero   integer     NOT NULL CHECK (pr_numero > 0),
  titulo      text        NOT NULL DEFAULT '',
  code        text        NOT NULL DEFAULT 'não identificado',
  evento      text        NOT NULL CHECK (evento IN ('aberta','pronta','publicada','fechada')),
  via         text        CHECK (via IN ('rapida','revisada')),
  sha         text        NOT NULL DEFAULT '',
  url         text,
  ocorrido_em timestamptz NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_dev_entrega_pr_evento_sha_key UNIQUE (pr_numero, evento, sha)
);
CREATE INDEX IF NOT EXISTS erp_dev_entrega_ocorrido_idx ON public.erp_dev_entrega (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS erp_dev_entrega_code_idx ON public.erp_dev_entrega (code, ocorrido_em DESC);
COMMENT ON TABLE public.erp_dev_entrega IS
  'Eventos das PRs para a aba Codes (aberta|pronta|publicada|fechada). Gravada só pelo workflow registrar-entrega.yml (service_role). Leitura só equipe PS.';

ALTER TABLE public.erp_dev_entrega ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_dev_entrega FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_dev_entrega TO authenticated;
GRANT ALL ON TABLE public.erp_dev_entrega TO service_role;
DROP POLICY IF EXISTS erp_dev_entrega_sel_equipe_ps ON public.erp_dev_entrega;
CREATE POLICY erp_dev_entrega_sel_equipe_ps ON public.erp_dev_entrega
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());
-- sem policy de INSERT/UPDATE/DELETE para authenticated: só a service_role (que ignora a RLS) grava

-- ── 3) leitura da caixa dos agentes pela equipe PS (só leitura, colunas do painel) ─────────────────────────────────
GRANT SELECT (id, para, de, tipo, assunto, status, pr_numero, resposta, arquivada,
              criado_em, recebida_em, iniciada_em, concluida_em, atualizado_em)
  ON TABLE public.erp_agente_mensagem TO authenticated;
DROP POLICY IF EXISTS erp_agente_mensagem_sel_equipe_ps ON public.erp_agente_mensagem;
CREATE POLICY erp_agente_mensagem_sel_equipe_ps ON public.erp_agente_mensagem
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

GRANT SELECT ON TABLE public.erp_agente_sessao_lease TO authenticated;
DROP POLICY IF EXISTS erp_agente_sessao_lease_sel_equipe_ps ON public.erp_agente_sessao_lease;
CREATE POLICY erp_agente_sessao_lease_sel_equipe_ps ON public.erp_agente_sessao_lease
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

GRANT SELECT (agente, aciona, atualizado_em) ON TABLE public.erp_agente_rotina TO authenticated;
DROP POLICY IF EXISTS erp_agente_rotina_sel_equipe_ps ON public.erp_agente_rotina;
CREATE POLICY erp_agente_rotina_sel_equipe_ps ON public.erp_agente_rotina
  FOR SELECT TO authenticated USING (public.fn_dev_painel_pode_ver());

-- ── 4) Realtime ──────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['erp_dev_entrega','erp_agente_mensagem','erp_agente_sessao_lease'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── 5) catálogo de telas (RD-50) ─────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, motivo_nao_auditavel, auditabilidade_em, criado_em, atualizado_em)
SELECT 'dashboard.dev.codes', '/dashboard/dev/codes', 'admin', 'Central de Desenvolvimento · Codes',
       'Em tempo real, por Code: trabalhando agora (sessão + tarefa em andamento), entregue nas últimas 24 h (PR publicada), em teste (PRs abertas) e fila (mensagens novas); faixa verde/vermelha e linha do tempo das publicações do dia.',
       'pronto', false, 'Só a equipe PS vê (fn_dev_painel_pode_ver); o robô de auditoria não é da equipe.', now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = '/dashboard/dev/codes');
