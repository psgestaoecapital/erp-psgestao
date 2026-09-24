-- XML autorizado da NF-e guardado no Storage (decisão do CEO 24/09). Hoje descartamos o XML — só temos
-- o resumo (ref/numero/chave/protocolo). Sem o XML, "a Focus calcula o vTotTrib?" vira pesquisa na web
-- em vez de leitura de dado. Guardar o XML fecha essa lacuna (o #1751 já guardou o REQUEST; isto guarda
-- o RESULTADO) e alimenta o pré-voo/relatórios. A referência vai em erp_nfe_emitidas.xml_storage_path
-- (coluna já existe). Também gravamos o valor total aproximado dos tributos (vTotTrib) parseado do XML —
-- torna a Lei 12.741 uma leitura de dado.
--
-- Bucket PRIVADO (o XML tem dados fiscais); escrita/leitura server-side via service_role (o app serve por
-- rota autenticada/URL assinada, como a DANFE). Sem função SECURITY DEFINER — fora do gate check:fn-guards.

-- Bucket privado para os XMLs autorizados
insert into storage.buckets (id, name, public)
values ('fiscal-nfe-xml', 'fiscal-nfe-xml', false)
on conflict (id) do nothing;

-- Valor total aproximado dos tributos (Lei 12.741 · tag vTotTrib), parseado do XML autorizado.
-- Calculado pela Focus por NCM (NT/ IBPT) quando consumidor_final=1; NULL enquanto não baixamos o XML.
alter table public.erp_nfe_emitidas
  add column if not exists valor_total_tributos numeric;

comment on column public.erp_nfe_emitidas.valor_total_tributos is
  'Valor total aproximado dos tributos (Lei 12.741 · tag vTotTrib) parseado do XML autorizado. '
  'Prova empírica de que a Focus calcula (ou não) o IBPT por NCM. Preenchido ao guardar o XML.';
