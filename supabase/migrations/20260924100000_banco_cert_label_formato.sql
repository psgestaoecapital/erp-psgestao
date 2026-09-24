-- #14 (Rodrigo/Bradesco): a mensagem de campos faltantes dizia "Certificado digital (.pfx)" mesmo quando
-- o usuário escolheu "dois arquivos" (.crt + .key) — enganoso. O label vem de erp_banco_manifesto.campos
-- (a fn_banco_campos_faltantes só monta a lista). A tela aceita os dois formatos (converte .crt+.key em .pfx
-- server-side, /api/banco/cert-pfx), então o label passa a citar ambos. Idempotente (só toca o label antigo).
update public.erp_banco_manifesto m
set campos = (
  select jsonb_agg(
    case when c->>'id' = 'cert'
      then jsonb_set(c, '{label}', '"Certificado digital (.pfx ou .crt + .key)"'::jsonb)
      else c end
    order by ord
  )
  from jsonb_array_elements(m.campos) with ordinality as t(c, ord)
)
where provider in ('bradesco', 'sicoob')
  and exists (
    select 1 from jsonb_array_elements(m.campos) c
    where c->>'id' = 'cert' and c->>'label' = 'Certificado digital (.pfx)'
  );
