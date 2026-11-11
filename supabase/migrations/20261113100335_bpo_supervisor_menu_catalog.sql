-- BPO · Supervisor Dashboard (/dashboard/bpo/supervisor) — RD-95/RD-98: a tela real NAO estava no menu
-- por rota propria. A pagina canonica vive em /dashboard/bpo/supervisor; o menu "Painel Multi-Cliente"
-- apontava para /dashboard/bpo/supervisao, que e apenas um redirect server-side para /supervisor
-- (fix de regressao de 12/05/2026). Resultado: module_catalog nao tinha linha para a rota canonica
-- e o auditor aud8 (PDCA, 82/95) marcou "tela nao aparece no menu".
--
-- Correcao: repontar a MESMA linha de menu para a rota canonica /dashboard/bpo/supervisor. Nao cria
-- item duplicado (reaproveita a linha existente) e o redirect /supervisao continua valendo para
-- links/bookmarks antigos. Aditiva no sentido de nao apagar linha nem tocar dado de cliente; so
-- ajusta o destino de 1 linha de catalogo de menu. Idempotente: a 2a execucao nao encontra a origem
-- (ja repontada) e nao faz nada; guarda contra a rota canonica ja existir no catalogo.
-- Faixa do agente code-desenvolvedor-3 (segundos :35).
UPDATE public.module_catalog
   SET rota = '/dashboard/bpo/supervisor'
 WHERE rota = '/dashboard/bpo/supervisao'
   AND NOT EXISTS (
     SELECT 1 FROM public.module_catalog m2 WHERE m2.rota = '/dashboard/bpo/supervisor'
   );
