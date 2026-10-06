-- BUG FC Pisos (06/10): salvar papel "Gerente" em /dashboard/admin/acessos violava users_role_check.
-- A lista PAPEIS da tela oferece 'diretor' e 'gerente', que o CHECK não aceitava (user_companies já aceita).
-- Aditivo: mesma constraint com 2 valores a mais (superset — nenhuma linha existente deixa de valer).
-- Reverter: recriar o CHECK sem 'diretor','gerente' (só se nenhuma linha usar esses valores).

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'adm','adm_investimentos','acesso_total','admin','socio','diretor_industrial','gerente_planta','financeiro',
  'comercial','supervisor','coordenador','operacional','consultor','conselheiro','visualizador','operador_bpo',
  'supervisor_bpo','gestor_mfo','analista','cliente_pf','compliance','contador','dev','wealth_advisor','viewer',
  'diretor_area','gerente_processo','supervisor_turno','operador','rh_industrial','sst',
  'diretor','gerente']::text[]));
