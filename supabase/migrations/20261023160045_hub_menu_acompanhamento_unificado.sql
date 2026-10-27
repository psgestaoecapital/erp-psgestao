-- HB0 item 1 (Hub): "Acompanhamento" e "Resultado por obra" levavam à MESMA tela
-- (/projetos/acompanhamento faz redirect para /projetos/obras/resultado). Unifica no menu:
-- sai "Acompanhamento" do Hub; a rota segue viva (redirect) para favoritos antigos.
UPDATE public.module_catalog
   SET surface_in_groups = array_remove(surface_in_groups, 'hub')
 WHERE id = 'projetos_acompanhamento'
   AND 'hub' = ANY(surface_in_groups);
