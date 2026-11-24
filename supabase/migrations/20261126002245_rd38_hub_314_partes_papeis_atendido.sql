-- RD-38/RD-52: reconcilia o ledger de cobertura do blueprint vivo (tela 314).
-- O requisito 44e993ba está 'parcial', mas já está IMPLEMENTADO na tela viva
-- /dashboard/projetos/obras/[id]/partes (PR #5744): proprietário, contratante,
-- construtora executora, escritório gestor e representantes identificados
-- separadamente, com várias partes por papel (mais de um proprietário por obra).
-- UPDATE aditivo e idempotente (guarda status_baseline='parcial'); só o ledger
-- interno de cobertura, sem RLS/policy/grant e sem dado de cliente.
-- Code: desenvolvedor_4_g

UPDATE blueprint_tela_requisito
   SET status_baseline = 'atendido',
       evidencia_baseline = 'PR #5744 · /dashboard/projetos/obras/[id]/partes (papéis separados + várias partes por papel)'
 WHERE id = '44e993ba-4a43-4da3-9e56-837b963cef5d'
   AND status_baseline = 'parcial';
