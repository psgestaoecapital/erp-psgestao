-- companies.uf_fiscal — UF fiscal do emitente como FONTE DE VERDADE para o escopo do CFOP
-- (interna 5xxx / interestadual 6xxx). Antes a UF do emitente era derivada de companies.cidade_estado
-- (texto livre: "São Miguel do Oeste/SC", "Iporã do Oeste, sc", "Iporã do Oeste" sem UF, "Buenos Aires/AR").
-- O parser funcionava para umas e quebrava EM SILÊNCIO em outras — e o que quebra aqui é o CFOP da NOTA,
-- não um rótulo de tela (#1768). Agora coluna própria; o parser de texto vira só fallback de leitura,
-- nunca fonte de decisão fiscal.
--
-- Sequência (decisão CEO 24/09): coluna NULLABLE + backfill + guarda de emissão (código) AGORA. A
-- constraint NOT NULL p/ empresa brasileira entra num 2º passo, DEPOIS que o CEO preencher à mão as
-- empresas onde o parser não derivou (hoje: FCR Materiais). Adicionar NOT NULL agora faria a migration
-- falhar (FCR ficaria NULL). A guarda no nfe-builder já bloqueia emissão de BR sem uf_fiscal (fail-closed).

alter table public.companies add column if not exists uf_fiscal char(2);

comment on column public.companies.uf_fiscal is
  'UF fiscal do emitente (fonte de verdade do escopo do CFOP na NF-e). NULL para estrangeira (não emite NF-e BR) ou pendente de preenchimento manual. Guarda no nfe-builder bloqueia emissão de empresa BR sem esta UF.';

-- Backfill defensivo a partir de cidade_estado (mesmo parser das 27 UFs do nfe-builder). Onde não dá,
-- fica NULL — o CEO preenche à mão (nunca inventar UF, RD-38). Estrangeira (pais <> Brasil) e demos sem
-- endereço também ficam NULL. Só toca linhas ainda NULL (idempotente).
update public.companies c
set uf_fiscal = upper((regexp_match(upper(coalesce(c.cidade_estado, '')), '[/,]\s*([A-Z]{2})\s*$'))[1])
where c.uf_fiscal is null
  and upper((regexp_match(upper(coalesce(c.cidade_estado, '')), '[/,]\s*([A-Z]{2})\s*$'))[1]) = any(array[
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI',
    'RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  ]);

-- Demos (is_demo) sem endereço → 'SC' (UF-casa do tenant, igual ao demo "Cidade Exemplo/SC"). NÃO é
-- decisão fiscal sobre contribuinte real (RD-38): é dado de demonstração. Sem isto a guarda do nfe-builder
-- bloquearia a emissão de NF-e nas jornadas de demonstração. Empresa real fica de fora (só is_demo).
update public.companies set uf_fiscal = 'SC' where uf_fiscal is null and is_demo = true;
