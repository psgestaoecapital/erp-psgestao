-- Hub · Tipo de empresa + especialidades = ÁREA INTERNA DA PS (CEO 26/11, PARTE 1).
-- O tipo (modo) e os ramos definem o que a empresa enxerga no Hub e devem ser definidos pela PS no
-- cadastramento/liberação — NÃO pelo usuário da empresa (nem pelo Master). Mudança de ACESSO/RBAC.
-- Aditiva/cirúrgica (RD-52): CREATE OR REPLACE das 2 funções, trocando SÓ a guarda de quem escreve
-- (de "Master da empresa" para is_admin() = PS). Corpo e demais regras preservados; mantém REVOKE anon.
-- Não altera nenhum perfil já gravado (empresa_hub_perfil intacta). A leitura da empresa continua.

-- Obter: pode_editar passa a ser is_admin() (PS). A tela (HubPerfilCard) já respeita pode_editar →
-- usuário comum da empresa vê o tipo/ramos em MODO LEITURA (sem editar); só a PS edita.
create or replace function public.fn_hub_perfil_obter(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v public.empresa_hub_perfil%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() and p_company_id not in (select public.get_user_company_ids()) then
    raise exception 'Sem acesso a esta empresa' using errcode = '42501';
  end if;
  select * into v from public.empresa_hub_perfil where company_id = p_company_id;
  return jsonb_build_object(
    'configurado', found,
    'modo', coalesce(v.modo, 'construtora'),
    'ramos', to_jsonb(coalesce(v.ramos, '{}'::text[])),
    'pode_editar', public.is_admin(),
    'opcoes_ramo', (select coalesce(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'nome', r.nome, 'descricao', r.descricao) order by r.ordem), '[]'::jsonb)
                      from public.projetos_ref_ramo r where r.modo = 'prestadora'));
end $$;

-- Salvar: só a PS (is_admin). Usuário comum/Master da empresa não grava mais o próprio tipo.
create or replace function public.fn_hub_perfil_salvar(p_company_id uuid, p_modo text, p_ramos text[] default '{}')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_antes jsonb; v_ramos text[]; v_invalidos text[];
begin
  if auth.uid() is null then raise exception 'Sem sessão' using errcode = '42501'; end if;
  if not public.is_admin() then
    raise exception 'Somente a PS (administração) define o tipo de empresa no Hub. Fale com a PS.' using errcode = '42501';
  end if;
  if p_modo not in ('construtora','prestadora','escritorio','pessoa_fisica') then
    return jsonb_build_object('sucesso', false, 'erro', 'Tipo de empresa inválido');
  end if;
  if p_modo = 'prestadora' then
    v_ramos := array(select distinct unnest(coalesce(p_ramos, '{}'::text[])));
    if cardinality(v_ramos) = 0 then
      return jsonb_build_object('sucesso', false, 'erro', 'Escolha pelo menos uma especialidade (ex.: pisos, gesso, elétrica)');
    end if;
    select array_agg(x) into v_invalidos from unnest(v_ramos) x
     where not exists (select 1 from public.projetos_ref_ramo r where r.codigo = x and r.modo = 'prestadora');
    if v_invalidos is not null then
      return jsonb_build_object('sucesso', false, 'erro', 'Especialidade desconhecida: ' || array_to_string(v_invalidos, ', '));
    end if;
  elsif p_modo = 'escritorio' then
    v_ramos := array['arquitetura_projetos'];
  else
    v_ramos := array['edificacao'];
  end if;
  select to_jsonb(h) into v_antes from public.empresa_hub_perfil h where h.company_id = p_company_id;
  insert into public.empresa_hub_perfil (company_id, modo, ramos, atualizado_por, atualizado_em)
  values (p_company_id, p_modo, v_ramos, auth.uid(), now())
  on conflict (company_id) do update set modo = excluded.modo, ramos = excluded.ramos,
     atualizado_por = excluded.atualizado_por, atualizado_em = now();
  insert into public.empresa_hub_perfil_historico (company_id, antes, depois, user_id)
  values (p_company_id, v_antes, jsonb_build_object('modo', p_modo, 'ramos', v_ramos), auth.uid());
  return jsonb_build_object('sucesso', true, 'modo', p_modo, 'ramos', to_jsonb(v_ramos));
end $$;

-- check-fn-guards (regra 1): SECURITY DEFINER nunca exposta ao anon; GRANT a authenticated (um por statement).
REVOKE ALL ON FUNCTION public.fn_hub_perfil_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_perfil_obter(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_hub_perfil_salvar(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_perfil_salvar(uuid, text, text[]) TO authenticated;
