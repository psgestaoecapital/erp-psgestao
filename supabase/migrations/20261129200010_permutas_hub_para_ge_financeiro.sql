-- CEO 27/11 — Mover "Permutas" do Hub de Projetos para Gestão Empresarial › Financeiro.
--
-- Tela: /dashboard/gestao-empresarial/permutas (nova rota; a antiga /dashboard/hub/permutas redireciona 308).
--
-- O menu vem de fn_modulos_sidebar_por_area por mc.grupo = <área> + ramo + plano. Então trocar o `grupo` de
-- 'hub' para 'gestao_empresarial' JÁ tira a aba do Hub e a põe no GE. Reposiciona também a rota das chaves de
-- ajuda (erp_ajuda_campo, RD-95) e a tela (system_screens) para acompanhar.
--
-- NÃO troca o id 'hub_permutas' (interno; referenciado por ajuda/rbac/feature; RD-100 não se aplica a id interno —
-- não aparece ao usuário). ramos_aplicaveis: era ['hub_construtora'] (ramo do Hub); vira NULL = todas as empresas
-- GE veem (como os demais módulos do GE › Financeiro). ordem=60 → entre Fluxo de Caixa (55) e Cartões (65).
--
-- UPDATE de DADO DE REFERÊNCIA (catálogo/menu), NÃO toca dado de cliente. Idempotente e aditivo; backup ANTES (RD-52).
-- Plano: hub_permutas JÁ está no v15_gestao_empresarial_pro → o filtro de plano não bloqueia o GE (nada a fazer aqui).
--
-- PROVA RD-38 (DEMO/produção) — antes: grupo='hub', rota='/dashboard/hub/permutas', ramos=['hub_construtora'];
--   37 chaves de ajuda na rota antiga; system_screens.area='hub'.
-- depois: grupo='gestao_empresarial', rota='/dashboard/gestao-empresarial/permutas', ramos=NULL; 0 chaves na rota
--   antiga e 37 na nova; system_screens.area='gestao_empresarial' (o bloco DO no fim falha a migration se divergir).

-- 1) BACKUP (antes de qualquer UPDATE) — snapshot jsonb, idempotente (grava uma vez só)
create table if not exists public.module_catalog_bkp_permutas_move (
  backup_em timestamptz not null default now(),
  snapshot jsonb
);
insert into public.module_catalog_bkp_permutas_move (snapshot)
select to_jsonb(m.*) from public.module_catalog m
where m.id = 'hub_permutas'
  and not exists (select 1 from public.module_catalog_bkp_permutas_move);

create table if not exists public.erp_ajuda_campo_bkp_permutas_move (
  backup_em timestamptz not null default now(),
  chave text,
  rota_antiga text
);
insert into public.erp_ajuda_campo_bkp_permutas_move (chave, rota_antiga)
select chave, rota from public.erp_ajuda_campo
where rota = '/dashboard/hub/permutas'
  and not exists (select 1 from public.erp_ajuda_campo_bkp_permutas_move);

-- 2) module_catalog: sai do Hub, entra em Gestão Empresarial › Financeiro
update public.module_catalog set
  grupo = 'gestao_empresarial',
  subgrupo = 'financeiro',
  rota = '/dashboard/gestao-empresarial/permutas',
  ramos_aplicaveis = null,   -- era ['hub_construtora']; NULL = todas as empresas GE veem
  ordem = 60                 -- entre Fluxo de Caixa (55) e Cartões (65) no GE › Financeiro
where id = 'hub_permutas';

-- 3) ajuda (RD-95): a rota das chaves *permuta* acompanha a tela (os campos seguem com "?")
update public.erp_ajuda_campo set rota = '/dashboard/gestao-empresarial/permutas'
where rota = '/dashboard/hub/permutas';

-- 4) system_screens: a tela passa a ser do GE
update public.system_screens set
  rota = '/dashboard/gestao-empresarial/permutas',
  area = 'gestao_empresarial'
where id = 'dashboard.hub_permutas';

-- 5) PROVA RD-38 — falha a migration se o estado final divergir do esperado
do $$
declare
  v_grupo text; v_rota text; v_ramos text[];
  v_ajuda_antiga int; v_ajuda_nova int; v_scr int;
begin
  select grupo, rota, ramos_aplicaveis into v_grupo, v_rota, v_ramos
  from public.module_catalog where id = 'hub_permutas';
  if v_grupo is distinct from 'gestao_empresarial'
     or v_rota is distinct from '/dashboard/gestao-empresarial/permutas'
     or v_ramos is not null then
    raise exception 'RD-38: module_catalog hub_permutas nao reposicionado (grupo=%, rota=%, ramos=%)', v_grupo, v_rota, v_ramos;
  end if;

  select count(*) into v_ajuda_antiga from public.erp_ajuda_campo where rota = '/dashboard/hub/permutas';
  select count(*) into v_ajuda_nova   from public.erp_ajuda_campo where rota = '/dashboard/gestao-empresarial/permutas';
  if v_ajuda_antiga <> 0 then raise exception 'RD-38: ainda ha % chave(s) de ajuda na rota antiga', v_ajuda_antiga; end if;
  if v_ajuda_nova = 0 then raise exception 'RD-38: nenhuma chave de ajuda na rota nova'; end if;

  select count(*) into v_scr from public.system_screens
  where id = 'dashboard.hub_permutas' and rota = '/dashboard/gestao-empresarial/permutas' and area = 'gestao_empresarial';
  if v_scr <> 1 then raise exception 'RD-38: system_screens nao atualizado'; end if;

  raise notice 'RD-38 OK: Permutas no GE Financeiro; chaves de ajuda na rota nova=% ; antiga=0 ; system_screens ok', v_ajuda_nova;
end $$;
