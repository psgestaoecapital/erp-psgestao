-- Bug FC Pisos (06/10): salvar papel "Gerente" em /dashboard/admin/acessos quebrava com users_role_check.
-- A lista PAPEIS da tela oferece 'gerente' e 'diretor', que o CHECK não aceitava. Migration ADITIVA:
-- mesma constraint, lista ampliada (+gerente, +diretor). Nenhum dado é alterado (todo valor antigo continua válido).
-- Role desconhecido no mapeamento de nível já cai em 'visualizador' (nunca admin) — ver 20260721010100.
-- Reverter: recriar o CHECK sem 'gerente' e 'diretor' (só se nenhuma linha usar esses valores).

ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'adm','adm_investimentos','acesso_total','admin','socio','diretor_industrial','gerente_planta','financeiro',
  'comercial','supervisor','coordenador','operacional','consultor','conselheiro','visualizador','operador_bpo',
  'supervisor_bpo','gestor_mfo','analista','cliente_pf','compliance','contador','dev','wealth_advisor','viewer',
  'diretor_area','gerente_processo','supervisor_turno','operador','rh_industrial','sst',
  'gerente','diretor']::text[]));
