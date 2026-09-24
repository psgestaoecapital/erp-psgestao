-- FIX de identidade da tabela IBPT: a PK (ncm, uf, versao) IGNORAVA o EX (exceção da TIPI). O IBPT
-- repete o MESMO NCM com EX diferentes (0, 1, 2…), cada um com alíquota própria → o upsert em lote
-- colidia ("ON CONFLICT DO UPDATE command cannot affect row a second time") e 0 linhas gravavam.
-- Erro de desenho do #1754 (PK sem EX). Correção: identidade passa a ser (ncm, ex_tipi, uf, versao).
-- A coluna ex_tipi já existe; só entra na chave. Default '0' quando vazio (chave não aceita NULL).
-- A tabela está vazia (a carga falhou), então não há dado a migrar — mas o backfill fica robusto.

alter table public.fiscal_ibpt_aliquota alter column ex_tipi set default '0';
update public.fiscal_ibpt_aliquota set ex_tipi = '0' where ex_tipi is null or btrim(ex_tipi) = '';
alter table public.fiscal_ibpt_aliquota alter column ex_tipi set not null;

alter table public.fiscal_ibpt_aliquota drop constraint if exists pk_fiscal_ibpt_aliquota;
alter table public.fiscal_ibpt_aliquota add constraint pk_fiscal_ibpt_aliquota primary key (ncm, ex_tipi, uf, versao);
