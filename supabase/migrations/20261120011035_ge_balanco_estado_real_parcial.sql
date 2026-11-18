-- PDCA GE · /dashboard/gestao-empresarial/balanco-patrimonial (item5 da auditoria auditor_pdca_2 17/11)
-- Ajusta system_screens.estado_real de 'desconhecida' -> 'parcial' para a rota do Balanço Patrimonial.
-- Motivo: a tela está funcional (CRUD, "?", origem do dado), mas a jornada contábil só fecha com a
-- linha-plug "a apurar" (#5348) e o Capital Social/Reservas da DEMO ainda está incoerente (item2 escalado),
-- então o estado real é PARCIAL (não 'pronto', não 'desconhecida').
-- Metadados de catálogo (system_screens) — não toca dado de cliente, RLS, fiscal nem financeiro de cliente.
-- Aditiva/idempotente: UPDATE com WHERE guarda (só altera se ainda estiver 'desconhecida').
UPDATE public.system_screens
   SET estado_real = 'parcial',
       atualizado_em = now()
 WHERE id = 'ge_map_gestao_empresarial_balanco_patrimonial'
   AND estado_real = 'desconhecida';
