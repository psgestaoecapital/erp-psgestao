-- Reconcilia o baseline do blueprint vivo da P&M · tela 113 (Fees · PM-F F3) após a PR que criou a
-- rota /dashboard/pm/fees resolvendo à tela de Fees (/dashboard/pm/contratos).
--
-- RD-38 (prova no código+banco, 23/11): a tela de Fees já existe em /dashboard/pm/contratos (o item do
-- menu module_catalog id=pm_contratos já se chama "Fees"). Ela mostra, por fee ativo, a esteira
-- "1 · Briefing ✓ · 2 · Planejamento do mês ✓ · 3 · Jobs do mês" (data-testid fee-esteira) com os
-- botões "Fazer briefing" (fee-fazer-briefing), "Planejar o mês" (fee-planejar) e "Ver jobs"
-- (fee-jobs-mes · contratado × realizado via fn_agency_contrato_realizado). Falta, do F3, só o bloco
-- "pedidos de contrato parados com dias parado" — por isso PARCIAL, não atendido.
--
-- Aditivo e idempotente: só move a linha do F3 de 'ausente' para 'parcial' e registra a evidência.
-- Não toca os F1 (avisos) e F4, que seguem 'ausente'. Não altera dado de cliente.
UPDATE blueprint_tela_requisito
   SET status_baseline = 'parcial',
       evidencia_baseline = 'PR /dashboard/pm/fees → /dashboard/pm/contratos (item de menu "Fees"): esteira Briefing✓·Planejamento✓·Jobs gerados×contratados + botões Fazer briefing/Planejar o mês/Ver jobs presentes (fee-esteira). Falta: bloco "pedidos de contrato parados com dias parado".'
 WHERE vertical = 'pm'
   AND tela_num = 113
   AND requisito LIKE 'Tela Fees no lugar de%'
   AND status_baseline = 'ausente';
