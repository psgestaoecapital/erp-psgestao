-- Hub · menu: "Viagens" e "Controle de frota" juntos dentro do grupo "Obras" (CEO 24/11).
-- RD-38 (module_catalog, confirmado): projetos_viagens estava em subgrupo 'projetos_comercial' (ordem 113) e
-- projetos_frota em 'projetos_engenharia' (ordem 124). O grupo "Obras" = subgrupo 'projetos_obras' (ordens 130–135).
-- O menu agrupa por `subgrupo` e ordena por `ordem`; 136/137 estão livres no fim do grupo Obras.
-- Só reorganização de menu (grupo='hub' inalterado; rotas inalteradas: /dashboard/projetos/viagens e /frota).
-- Idempotente (UPDATE por id; re-rodar não muda nada). Nenhuma permissão/rota/estrutura alterada.
UPDATE public.module_catalog SET subgrupo='projetos_obras', ordem=136 WHERE id='projetos_viagens';
UPDATE public.module_catalog SET subgrupo='projetos_obras', ordem=137 WHERE id='projetos_frota';
