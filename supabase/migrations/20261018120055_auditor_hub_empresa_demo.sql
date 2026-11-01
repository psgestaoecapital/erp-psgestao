-- Ferramenta do Code-Auditor (eng-chefe-auto) — cobrir o Hub na auditoria VISUAL por lote.
-- Tarefa do Eng. Chefe (msg 1b9efbfd, item 3): mapear a área 'projetos' para a DEMO, para a
-- /dashboard/projetos/calculadora (area='projetos') entrar na auditoria por lote.
--
-- PROVADO NO DADO (RD-38):
--   fn_demo_da_area('projetos') = NULL  ->  /dashboard/projetos/calculadora (area='projetos')
--   é pulada como "sem_demo" por fn_disparar_playwright_batch e nunca é fotografada no lote.
--   A fn_disparar_playwright_batch JÁ envia empresa_id no corpo (confirmado na definição viva);
--   o ÚNICO furo do Hub nesse caminho era a área 'projetos' sem DEMO mapeada — por isso basta o
--   apelido abaixo. A checagem por linha (fn_demo_da_area) continua como trava LGPD (RD-69).
--
-- REVISÃO (gilberto-revisor, PR #2846): a versão anterior desta PR reescrevia fn_auditor_disparar
-- e fn_disparar_playwright_batch repetindo o segredo x-watcher-secret no corpo das funções, o que
-- DESFAZIA a #2829 (P1 — segredo retirado do corpo para o cofre). Removido: esta PR ficou SÓ com o
-- apelido de área, que é ADITIVO, não tem segredo e não reescreve função nenhuma. A melhoria de
-- fn_auditor_disparar (enviar empresa_id na via por rota) será reconstruída SOBRE a #2829, usando
-- fn_watcher_secret(), para não reintroduzir o literal.
--
-- RD-97: ADITIVO. Só um INSERT de apelido de área apontando para um DEMO que já existe. Não toca
-- função, financeiro, fiscal, RLS, autenticação nem dado de cliente. O screen-watcher só renderiza
-- a empresa DEMO (LGPD preservado; o batch segue pulando áreas sem_demo).
--
-- ROLLBACK:  DELETE FROM public.demo_por_area WHERE area = 'projetos';

INSERT INTO public.demo_por_area (area, company_id)
SELECT 'projetos', 'b0700000-0000-4000-a000-000000000006'::uuid
WHERE EXISTS (
  SELECT 1 FROM public.companies c
  WHERE c.id = 'b0700000-0000-4000-a000-000000000006'::uuid AND c.is_demo = true
)
ON CONFLICT (area) DO NOTHING;

-- Prova no deploy (RD-38): a área 'projetos' passa a resolver para o DEMO da Construtora Modelo.
-- Como fn_demo_da_area só devolve empresa com is_demo=true, isto também garante que o apelido
-- aponta para um DEMO (nunca empresa real).
DO $$
DECLARE v_demo uuid;
BEGIN
  v_demo := public.fn_demo_da_area('projetos');
  IF v_demo IS DISTINCT FROM 'b0700000-0000-4000-a000-000000000006'::uuid THEN
    RAISE EXCEPTION 'fn_demo_da_area(''projetos'') não resolveu para o DEMO da Construtora Modelo (devolveu %).',
      COALESCE(v_demo::text, 'NULL');
  END IF;
END $$;
