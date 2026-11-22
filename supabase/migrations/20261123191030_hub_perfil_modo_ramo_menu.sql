-- =====================================================================
-- Hub · ONDA M0 — Perfil da empresa no Hub (modo + ramo) e menu lateral por modo
-- Blueprint hub_projetos: governadora 328 · menu 312 · organização 313 · padrão 333
-- Decisão do CEO 21/11:
--   construtora vê o Hub inteiro;
--   prestadora (piso, gesso, elétrica…) vê as telas de prestadora + a biblioteca do seu ramo;
--   escritório vê as suas telas;
--   pessoa física vê a versão enxuta.
-- REUSO (RD-26): o menu lateral JÁ filtra por module_catalog.ramos_aplicaveis && ramos_da_empresa().
--   Aqui só se acrescenta o token do modo ('hub_<modo>') a ramos_da_empresa e se marca os módulos.
-- Empresa SEM perfil = 'hub_construtora' (vê tudo, igual a hoje) → nada some de quem já usa.
-- DEPENDE de 20261123190030_hub_padrao_orcamento_eap (tabela projetos_ref_ramo) — PR #5777.
-- =====================================================================
begin;

create table if not exists public.empresa_hub_perfil (
  company_id     uuid primary key references public.companies(id) on delete cascade,
  modo           text not null check (modo in ('construtora','prestadora','escritorio','pessoa_fisica')),
  ramos          text[] not null default '{}',
  atualizado_por uuid,
  atualizado_em  timestamptz not null default now(),
  criado_em      timestamptz not null default now()
);
comment on table public.empresa_hub_perfil is 'Hub · modo de uso da empresa (define o menu) e ramos (definem a biblioteca do catálogo/orçamento). Blueprint hub_projetos 328/313.';

create table if not exists public.empresa_hub_perfil_historico (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  antes      jsonb,
  depois     jsonb not null,
  user_id    uuid,
  criado_em  timestamptz not null default now()
);

alter table public.empresa_hub_perfil           enable row level security;
alter table public.empresa_hub_perfil_historico enable row level security;
drop policy if exists hub_perfil_leitura on public.empresa_hub_perfil;
create policy hub_perfil_leitura on public.empresa_hub_perfil for select to authenticated
  using (public.is_admin() or company_id in (select public.get_user_company_ids()));
drop policy if exists hub_perfil_hist_leitura on public.empresa_hub_perfil_historico;
create policy hub_perfil_hist_leitura on public.empresa_hub_perfil_historico for select to authenticated
  using (public.is_admin() or company_id in (select public.get_user_company_ids()));
revoke insert, update, delete on public.empresa_hub_perfil, public.empresa_hub_perfil_historico from anon, authenticated;
grant select on public.empresa_hub_perfil, public.empresa_hub_perfil_historico to authenticated;

-- ramos_da_empresa: definição atual + token do modo do Hub (sem perfil = hub_construtora)
create or replace function public.ramos_da_empresa(p_company_id uuid)
returns text[] language sql stable security definer set search_path to 'public' as $$
  SELECT coalesce(array_agg(DISTINCT r) FILTER (WHERE r IS NOT NULL AND btrim(r) <> ''), ARRAY[]::text[])
  FROM (
    SELECT lower(btrim(c.industria_subtipo)) AS r FROM companies c WHERE c.id = p_company_id
    UNION
    SELECT lower(btrim(e)) FROM industrial_plants p, unnest(coalesce(p.especies, ARRAY[]::text[])) e
     WHERE p.company_id = p_company_id AND coalesce(p.is_active, true) = true
    UNION
    SELECT COALESCE(
      (SELECT lower(btrim(op.ramo)) FROM erp_oficina_parametros op WHERE op.company_id = p_company_id),
      CASE WHEN EXISTS (SELECT 1 FROM erp_os o WHERE o.company_id = p_company_id) THEN 'automotiva' END)
    UNION
    SELECT 'hub_' || COALESCE((SELECT hp.modo FROM empresa_hub_perfil hp WHERE hp.company_id = p_company_id), 'construtora')
     WHERE p_company_id IS NOT NULL
  ) z;
$$;
-- check-fn-guards (regra 1): REVOKE anon ancorado por função (no-op p/ anon; CREATE OR REPLACE preserva o ACL vivo
-- postgres+service_role — ramos_da_empresa NÃO é concedida a authenticated, igual a hoje).
REVOKE ALL ON FUNCTION public.ramos_da_empresa(uuid) FROM PUBLIC, anon;

-- Obter perfil (tela Configurações do Hub)
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
    'pode_editar', public.fn_compras_alcada_usuario_master(p_company_id),
    'opcoes_ramo', (select coalesce(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'nome', r.nome, 'descricao', r.descricao) order by r.ordem), '[]'::jsonb)
                      from public.projetos_ref_ramo r where r.modo = 'prestadora'));
end $$;

-- Salvar perfil (só Master/sócio/admin) · histórico imutável
create or replace function public.fn_hub_perfil_salvar(p_company_id uuid, p_modo text, p_ramos text[] default '{}')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_antes jsonb; v_ramos text[]; v_invalidos text[];
begin
  if auth.uid() is null then raise exception 'Sem sessão' using errcode = '42501'; end if;
  perform public.fn__guarda_empresa(p_company_id);
  if not public.fn_compras_alcada_usuario_master(p_company_id) then
    raise exception 'Somente Master pode definir o tipo de empresa no Hub' using errcode = '42501';
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

-- Gate de rota do Hub (endereço digitado direto) · mesmo padrão de fn_ehs_rota_permitida
create or replace function public.fn_hub_rota_permitida(p_company_id uuid, p_rota text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with tela as (
    select mc.ramos_aplicaveis from public.module_catalog mc
     where mc.grupo = 'hub' and mc.ativo and mc.rota is not null and p_rota like split_part(mc.rota, '?', 1) || '%'
     order by length(mc.rota) desc limit 1)
  select case
    when p_company_id is null then true
    when not exists (select 1 from tela) then true
    when (select ramos_aplicaveis from tela) is null or cardinality((select ramos_aplicaveis from tela)) = 0 then true
    else (select ramos_aplicaveis from tela) && public.ramos_da_empresa(p_company_id) end;
$$;

-- check-fn-guards (regra 1): REVOKE/GRANT ancorado por função (um por statement, senão o regex do gate não casa).
REVOKE ALL ON FUNCTION public.fn_hub_perfil_obter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_perfil_obter(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_hub_perfil_salvar(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_perfil_salvar(uuid, text, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_hub_rota_permitida(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hub_rota_permitida(uuid, text) TO authenticated;

-- Matriz menu × modo (V30 §5). NULL = os 4 modos veem.
update public.module_catalog set ramos_aplicaveis = array['hub_construtora','hub_prestadora','hub_escritorio']
 where grupo = 'hub' and id in ('projetos_oportunidades','projetos_clientes','projetos_visitas','projetos_viagens','projetos_desempenho',
   'projetos_engenharia','projetos_takeoff','projetos_resultado_obra','hub_plano_acao','hub_conectores_erp');
update public.module_catalog set ramos_aplicaveis = array['hub_construtora','hub_prestadora']
 where grupo = 'hub' and id in ('projetos_insumos','projetos_mao_obra','projetos_frota','projetos_tabela_preco','hub_ordens_servico');
update public.module_catalog set ramos_aplicaveis = array['hub_construtora','hub_escritorio','hub_pessoa_fisica']
 where grupo = 'hub' and id = '67308c8f-b686-4d19-b23c-c31284931d81';  -- Simulador de Obra
update public.module_catalog set ramos_aplicaveis = array['hub_construtora']
 where grupo = 'hub' and id = 'hub_permutas';
update public.module_catalog set ramos_aplicaveis = array['hub_construtora','hub_escritorio']
 where grupo = 'hub' and id = 'hub_viabilidade_ia';  -- inativo hoje; já nasce certo
-- Ficam NULL (todos): projetos_hub, projetos_propostas, hub_orcamento_itens, projetos_agenda, projetos_calculadora,
-- projetos_instalar_app, projetos_catalogo, projetos_obras, projetos_acompanhamento, projetos_cockpit_obra, projetos_configuracoes

-- Prova (RD-38)
do $$ begin
  if (select count(*) from public.module_catalog where grupo='hub' and ramos_aplicaveis is not null) < 17 then
    raise exception 'Matriz de menu incompleta';
  end if;
  if not ('hub_construtora' = any(public.ramos_da_empresa('b0700000-0000-4000-a000-000000000006'))) then
    raise exception 'Fallback construtora falhou';
  end if;
end $$;

commit;
