-- IBPT (Lei 12.741/2012) — cálculo. Núcleo reusável: dado (NCM, EX, UF do destinatário, origem), devolve
-- as alíquotas aproximadas VIGENTES na data. A Focus NÃO calcula isto (provado no dado: reparse das NF-e
-- KGF, com_vtottrib=0), então o cálculo é nosso, sobre a tabela fiscal_ibpt_aliquota (núcleo, 27 UFs).
--
-- Regras (decisão CEO 24/09):
--  1. Busca por (NCM, EX, UF, versão vigente hoje). O EX importa (há NCMs repetidos com EX diferente).
--  2. Federal: origem 0/3/4/5 = alíquota NACIONAL; demais (1/2/6/7/8) = IMPORTADO (Ajuste SINIEF 20/2012).
--  (Regras 3–8 — valor por item, só regime normal, só consumidor_final, fonte no infCpl, cobertura
--   parcial, empresa estrangeira — moram no caminho de emissão que consome esta função.)
-- FONTES: Lei 12.741/2012 art. 1º; Decreto 8.264/2014; Ajuste SINIEF 20/2012 (código de origem).
--
-- SECURITY INVOKER (sem SECURITY DEFINER): a tabela é global/núcleo (RLS SELECT p/ authenticated), e o
-- caminho de emissão chama via service_role. Sem dado por-tenant, não há o que escopar por auth.uid.

create or replace function public.fn_ibpt_aliquota_vigente(
  p_ncm text,
  p_ex text default '0',
  p_uf text default null,
  p_origem text default null,
  p_data date default current_date
)
returns table(
  federal numeric, estadual numeric, municipal numeric, total numeric,
  fonte text, chave_ibpt text, versao text
)
language sql
stable
set search_path to 'public'
as $$
  with alvo as (
    select a.*,
      case when coalesce(p_origem, '') in ('0','3','4','5')
           then a.aliquota_nacional_federal else a.aliquota_importado_federal end as fed
    from public.fiscal_ibpt_aliquota a
    where a.ncm = regexp_replace(coalesce(p_ncm, ''), '\D', '', 'g')
      and a.ex_tipi = coalesce(nullif(btrim(p_ex), ''), '0')
      and (p_uf is null or a.uf = upper(btrim(p_uf)))
      and (a.vigencia_inicio is null or a.vigencia_inicio <= p_data)
      and (a.vigencia_fim   is null or a.vigencia_fim   >= p_data)
    order by a.vigencia_inicio desc nulls last, a.versao desc
    limit 1
  )
  select fed as federal, aliquota_estadual as estadual, aliquota_municipal as municipal,
         round(coalesce(fed,0) + coalesce(aliquota_estadual,0) + coalesce(aliquota_municipal,0), 2) as total,
         fonte, chave_ibpt, versao
  from alvo;
$$;

revoke all on function public.fn_ibpt_aliquota_vigente(text, text, text, text, date) from anon;
grant execute on function public.fn_ibpt_aliquota_vigente(text, text, text, text, date) to authenticated, service_role;
