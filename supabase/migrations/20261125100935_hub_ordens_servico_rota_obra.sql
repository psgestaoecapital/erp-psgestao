-- Hub · auditoria CEO 20/11: o item "Ordens de Serviço" (hub_ordens_servico) do menu do Hub apontava para
-- /dashboard/os — que é a OS da OFICINA (placa, mecânico, "os-mec-v1"). O Hub tem a sua própria OS de obra
-- em /dashboard/projetos/obras/os. Correção: aponta o item para a OS de obra. Aditiva (UPDATE de 1 linha de
-- catálogo), não toca dado de cliente. RD-38: confere antes/depois no PR.
UPDATE public.module_catalog
   SET rota = '/dashboard/projetos/obras/os'
 WHERE id = 'hub_ordens_servico' AND rota = '/dashboard/os';
