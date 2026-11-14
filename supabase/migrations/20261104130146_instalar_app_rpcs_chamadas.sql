-- RD-98 p3 (rastreabilidade): declarar as RPCs que a tela /dashboard/projetos/instalar-app chama.
-- Gap do auditor (aud8 93/95): system_screens.rpcs_chamadas = NULL.
-- A tela usa o componente comum InstalarApp, que chama fn_app_instalacao_contagem (leitura) e
-- fn_app_instalacao_registrar (grava a instalação). Ambas confirmadas em produção (RD-38).
-- Aditiva/idempotente: UPDATE de metadado do catálogo de telas (system_screens), sem dado de cliente;
-- re-rodar grava o mesmo valor. WHERE pela rota exata.
-- Code: desenvolvedor_4_g

UPDATE public.system_screens
SET rpcs_chamadas = ARRAY['fn_app_instalacao_contagem','fn_app_instalacao_registrar']::text[],
    atualizado_em = now()
WHERE rota = '/dashboard/projetos/instalar-app';
