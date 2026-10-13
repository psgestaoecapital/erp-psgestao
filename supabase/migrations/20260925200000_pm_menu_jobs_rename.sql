-- P&M · menu (CEO 25/09, urgente): renomear o item de menu "Workspace da Agência" → "Jobs".
-- Motivo: a equipe da PDOIS procura por "jobs" e não acha. Nome que não é o do usuário é tela
-- invisível (mesmo padrão dos chamados de DRE Consolidado / Produtos / foto da vistoria).
-- Os contextos 1b105e60 / 905a5cbf tratam de MOVER e VALIDAR a tela, não de escolher o nome —
-- "Workspace" era jargão interno, não deliberado como rótulo de usuário.
-- O TÍTULO da página (/dashboard/producao) segue "Workspace · Produção & Marketing" (no código,
-- não tocado aqui): o menu fala a língua de quem usa, a página pode ter o nome completo.
-- Só dados; sem função SECURITY DEFINER.

UPDATE public.module_catalog
SET nome = 'Jobs'
WHERE id = 'pm_jobs' AND grupo = 'pm' AND nome = 'Workspace da Agência';
