-- #3842 (Karol/SST) · Pausas térmicas · aba Conferência: ao ajustar um dia "conferido com o
-- colaborador", a responsável tem um documento impresso em que o colaborador assina e informa o
-- horário da pausa que esqueceu de registrar. Antes não havia onde guardar essa prova. Agora o
-- comprovante assinado fica anexado à correção do dia (ligado ao LOTE da releitura), provando que o
-- colaborador teve ciência do ajuste.
--
-- ADITIVA (RD-94.1 c): tabela e função NOVAS, RLS ligada, policy por empresa, REVOKE anon. A função
-- só faz INSERT numa tabela nova — nenhum UPDATE/DELETE em dado de cliente, nenhum CREATE OR REPLACE
-- de função/view existente.

create table if not exists public.nr36_releitura_anexo (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  lote uuid not null,
  arquivo_path text not null,
  arquivo_nome text,
  autor_id uuid default auth.uid(),
  criado_em timestamptz not null default now()
);

create index if not exists ix_nr36_releitura_anexo_lote on public.nr36_releitura_anexo (lote);
create index if not exists ix_nr36_releitura_anexo_company on public.nr36_releitura_anexo (company_id);

alter table public.nr36_releitura_anexo enable row level security;

-- leitura: admin ou quem é da empresa (mesmo padrão de nr36_releitura_justificativa)
drop policy if exists nr36_releitura_anexo_ler on public.nr36_releitura_anexo;
create policy nr36_releitura_anexo_ler on public.nr36_releitura_anexo
  for select using (is_admin() or (company_id in (select get_user_company_ids())));

revoke all on public.nr36_releitura_anexo from anon;
grant select on public.nr36_releitura_anexo to authenticated;

-- escrita só pela função (SECURITY DEFINER) — nunca direto na tabela
create or replace function public.fn_nr36_releitura_anexar(
  p_company_id uuid, p_lote uuid, p_arquivo_path text, p_arquivo_nome text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  perform public.fn_nr36_assert(p_company_id);
  if p_lote is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_lote', 'mensagem', 'Releitura não identificada.');
  end if;
  if coalesce(btrim(p_arquivo_path), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'sem_arquivo', 'mensagem', 'Informe o arquivo do comprovante.');
  end if;
  -- o lote tem de ser desta empresa (não deixa anexar em releitura de outra empresa)
  if not exists (
    select 1 from public.nr36_releitura_justificativa j
    where j.lote = p_lote and j.company_id = p_company_id
  ) then
    return jsonb_build_object('ok', false, 'erro', 'lote_invalido', 'mensagem', 'Releitura não pertence a esta empresa.');
  end if;
  insert into public.nr36_releitura_anexo (company_id, lote, arquivo_path, arquivo_nome)
  values (p_company_id, p_lote, btrim(p_arquivo_path), nullif(btrim(p_arquivo_nome), ''))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

revoke all on function public.fn_nr36_releitura_anexar(uuid, uuid, text, text) from anon, public;
grant execute on function public.fn_nr36_releitura_anexar(uuid, uuid, text, text) to authenticated;

-- RD-95 · "?" do novo campo (catálogo global; sem dono; ON CONFLICT DO NOTHING — nada existente muda)
insert into public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, status)
values (
  'compliance.pausas.conferencia.comprovante',
  '/dashboard/compliance/pausas-tecnicas',
  'Conferência',
  'Comprovante do ajuste (opcional)',
  'Anexe o documento assinado pelo colaborador em que ele informa o horário da pausa que esqueceu de registrar. Aceita PDF ou imagem.',
  'Guarda a prova de que o colaborador teve ciência da correção do dia. Fica ligado a este ajuste e pode ser auditado depois.',
  'A folha impressa que o colaborador assinou confirmando o horário da pausa.',
  'Anexar um arquivo que não é do colaborador ou do dia corrigido. O comprovante tem de ser do ajuste que você está gravando.',
  0,
  'publicado'
)
on conflict (chave) do nothing;
