-- Fonte única do mapeamento role→nível (extraído verbatim do CASE de fn_modulos_sidebar_por_area).
-- Usado pelas RPCs de Acessos (Fase 1) e pelo refactor da própria sidebar (migração seguinte). IMMUTABLE.
CREATE OR REPLACE FUNCTION public.fn_role_to_nivel(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE LOWER(COALESCE(p_role, ''))
    WHEN 'adm' THEN 'administrador' WHEN 'admin' THEN 'administrador'
    WHEN 'acesso_total' THEN 'administrador' WHEN 'socio' THEN 'socio'
    WHEN 'sócio' THEN 'socio' WHEN 'diretor' THEN 'diretor'
    WHEN 'gerente' THEN 'gerente' WHEN 'comercial' THEN 'comercial'
    WHEN 'financeiro' THEN 'financeiro' WHEN 'consultor' THEN 'consultor'
    WHEN 'contador' THEN 'contador_admin' WHEN 'coordenador' THEN 'coordenador'
    WHEN 'operacional' THEN 'operacional' WHEN 'supervisor' THEN 'supervisor'
    WHEN 'cliente_bpo' THEN 'cliente_bpo' WHEN 'cliente_wealth' THEN 'cliente_wealth'
    WHEN 'diretor_area' THEN 'diretor_area' WHEN 'gerente_planta' THEN 'gerente_planta'
    WHEN 'gerente_processo' THEN 'gerente_processo' WHEN 'supervisor_turno' THEN 'supervisor_turno'
    WHEN 'operador' THEN 'operador' WHEN 'rh_industrial' THEN 'rh_industrial' WHEN 'sst' THEN 'sst'
    WHEN 'viewer' THEN 'visualizador'
    ELSE 'visualizador' END
$$;
GRANT EXECUTE ON FUNCTION public.fn_role_to_nivel(text) TO authenticated, anon, service_role;
