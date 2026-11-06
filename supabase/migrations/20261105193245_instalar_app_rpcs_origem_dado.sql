-- RD-98 pilar 3 (ORIGEM DO DADO) — PDCA Hub /dashboard/projetos/instalar-app
-- A tela (PR #3596) passou a chamar 2 RPCs reais, mas system_screens.rpcs_chamadas ficou NULL.
-- FIX de dados, não-destrutivo e idempotente: popula a origem do dado da rota.
-- A tela consome dado só por RPC (consulta + gravação); não lê view -> views_consumidas fica como está.

BEGIN;

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_app_instalacao_registrar','fn_app_instalacao_contagem']
 WHERE rota = '/dashboard/projetos/instalar-app';

DO $$
DECLARE v text[];
BEGIN
  SELECT rpcs_chamadas INTO v FROM public.system_screens WHERE rota = '/dashboard/projetos/instalar-app';
  IF v IS DISTINCT FROM ARRAY['fn_app_instalacao_registrar','fn_app_instalacao_contagem'] THEN
    RAISE EXCEPTION 'RD-98 p3: rpcs_chamadas da instalar-app nao ficou com as 2 RPCs esperadas (valor=%)', v;
  END IF;
END $$;

COMMIT;
