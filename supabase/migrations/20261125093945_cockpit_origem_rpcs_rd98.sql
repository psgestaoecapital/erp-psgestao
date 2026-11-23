-- RD-98 p3 (origem do dado) · Cockpit da obra (/dashboard/projetos/cockpit)
-- A tela tinha `views_consumidas` correto mas `rpcs_chamadas` VAZIO.
--
-- Fontes conferidas no código vivo (RD-38), não supostas:
--   src/app/dashboard/projetos/cockpit/page.tsx lê as views
--   `v_obra_resultado_alocado` e `projetos_obras` (supabase.from) — já registradas.
--   Os únicos RPCs da tela vêm do componente padrão de ajuda
--   `src/components/ajuda/AjudaCampo.tsx`: `fn_ajuda_campo_listar` (l.23) e
--   `fn_ajuda_campo_uso` (l.46) — mesmo padrão já registrado em telas irmãs
--   (ex.: /dashboard/analises).
-- As 2 funções existem em produção (pg_proc, public).
--
-- Segurança: aditivo e idempotente. Só UPDATE em `system_screens` (metadado
-- interno de auditoria). Não toca núcleo, RLS, menu, função nem dado de cliente.
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_ajuda_campo_listar','fn_ajuda_campo_uso']::text[]
 WHERE rota = '/dashboard/projetos/cockpit';
