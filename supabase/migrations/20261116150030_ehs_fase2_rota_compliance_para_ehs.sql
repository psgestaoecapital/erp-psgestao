-- Renomeação Compliance → EHS · FASE 2 (CEO 14/11, decisão B) — ROTAS.
--
-- A pasta de rotas foi movida (src/app/dashboard/compliance → src/app/dashboard/ehs) e o caminho antigo
-- /dashboard/compliance/* ganhou redirect 308 permanente no next.config.ts. Aqui o catálogo de telas
-- (system_screens) passa a apontar para o caminho novo, para o menu e as auditorias baterem com a rota real.
--
-- Escopo: só a COLUNA `rota` das telas cujo caminho começa em /dashboard/compliance. As duas telas de
-- área=compliance cuja rota NÃO vive sob /dashboard/compliance — /dashboard/lgpd/meus-dados e
-- /sign/epi/[token] — NÃO são tocadas aqui (mantêm a rota; a chave `area` muda só na Fase 3).
--
-- Seguro: `rota` é UNIQUE; o replace é 1:1 (cada /dashboard/compliance/* vira um /dashboard/ehs/* distinto)
-- e não existe nenhuma rota /dashboard/ehs/* ainda → sem colisão. Idempotente (ao re-rodar, 0 linhas casam).
-- Aditivo, sem dado de cliente.

UPDATE public.system_screens
   SET rota = replace(rota, '/dashboard/compliance', '/dashboard/ehs')
 WHERE rota LIKE '/dashboard/compliance%';
