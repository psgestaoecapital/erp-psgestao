-- Remove overload antigo de 1 arg (conflita com a versao 2-arg do #423).
DROP FUNCTION IF EXISTS public.fn_listar_areas_visiveis(uuid);
