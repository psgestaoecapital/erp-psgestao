-- P&M · Bot · Histórico de envios — esconde o RUÍDO técnico de e2e só na empresa DEMO
-- ============================================================================
-- GAP (reauditoria aud8 12/11, /dashboard/pm/... Bot, nota 94→95, critério e — nomes
-- na língua do cliente): o "Histórico de envios" da DEMO (002) exibe nomes técnicos de
-- execução automatizada — "Novo job: E2E Social carrossel MWDOOHNL", "Teste importação
-- SIGA", "Teste Bloco 1 1794496034133", "... Xilofone mwdomt4y (tela)" — hashes, ids
-- efêmeros e números de epoch. A tabela public.erp_pm_bot_envio acumula ~3,1 mil linhas
-- de rodadas e2e na DEMO (o fn_demo_reset não a toca), e o usuário as enxerga.
--
-- DIAGNÓSTICO RD-38 (produção, company_id=b0700000-0000-4000-a000-000000000002):
--   total=3136, ruído de e2e=2780, nomes de campanha reais=356 (15 títulos distintos:
--   "Novo job: Campanha de Natal", "Estouro de horas: Bom dia com café coado",
--   "Prazo em 24h: Carrossel — coleção primavera", "Aprovação pendente: Post — adoção
--   responsável", "PS Gestão · teste do bot", ...). Os nomes reais JÁ existem — bastava
--   não exibir o ruído.
--
-- CORREÇÃO (cirúrgica, SÓ na DEMO): fn_pm_bot_envio_listar passa a ocultar, quando a
-- empresa é is_demo, os títulos com marca inequívoca de teste automatizado:
--   • id efêmero do e2e  (mw<base36>, maiúsc./minúsc. — ex.: MWDOOHNL, mwdomt4y, mw4qirum)
--   • o literal "E2E"
--   • "Teste …" com T maiúsculo (o e2e usa "Teste Bloco/importação …"; preserva o
--     "teste do bot" minúsculo, que é o resultado real do botão "Testar envio")
--   • epoch embutido (9+ dígitos seguidos)
-- Em PRODUÇÃO (não-demo) NADA é filtrado — o histórico real aparece inteiro. Nenhum dado
-- é apagado; é só filtro de exibição. Não toca RLS, não grava, não altera dado de cliente.
--
-- RD-38 (prova no dado, exibição):
--   -- ANTES: fn_pm_bot_envio_listar(002, 20) -> topo = "E2E Social carrossel ...", "Teste
--   --   importação SIGA", "Carrossel ... Xilofone mwdomt4y" (ruído técnico).
--   -- DEPOIS: topo = só nomes de campanha reais (Campanha de Natal, Carrossel — coleção
--   --   primavera, Post — adoção responsável, ...).
--   -- Empresa real (is_demo=false): retorno idêntico ao atual (nenhum filtro aplicado).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_pm_bot_envio_listar(p_company_id uuid, p_limite integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lim  int;
  v_out  jsonb;
  v_demo boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_lim := LEAST(GREATEST(coalesce(p_limite, 20), 1), 100);

  -- é empresa de demonstração? (só então escondemos o ruído de e2e)
  SELECT coalesce(bool_or(c.is_demo), false) INTO v_demo
    FROM public.companies c WHERE c.id = p_company_id;

  SELECT coalesce(jsonb_agg(x ORDER BY x.criado_em DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT e.id, e.evento, e.titulo, e.texto, e.status, e.http_status, e.erro, e.criado_em, e.enviado_em
      FROM public.erp_pm_bot_envio e
     WHERE e.company_id = p_company_id
       AND (
            NOT v_demo                      -- produção: sem filtro
         OR e.titulo IS NULL                -- sem título não é ruído por nome
         OR NOT (
                 e.titulo ~* '\mmw[0-9a-z]{5,}\M'  -- id efêmero do e2e (mw…/MWD…)
              OR e.titulo ~  'E2E'
              OR e.titulo ~  '\mTeste\M'           -- "Teste …" (maiúsculo) do e2e
              OR e.titulo ~  '[0-9]{9,}'           -- epoch embutido
            )
       )
     ORDER BY e.criado_em DESC
     LIMIT v_lim
  ) x;

  RETURN v_out;
END;
$function$;

-- Guarda de função (REVOKE anon): a régua de CI exige a declaração explícita na migration
-- que recria uma SECURITY DEFINER. Função só de leitura, trancada por fn__guarda_empresa.
REVOKE ALL ON FUNCTION public.fn_pm_bot_envio_listar(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_bot_envio_listar(uuid, integer) TO authenticated, service_role;
