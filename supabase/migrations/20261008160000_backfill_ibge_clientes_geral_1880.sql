-- Chamado #1880 — Backfill GERAL do codigo_ibge_municipio dos clientes (tomador da NFS-e).
-- Sem o IBGE do município do tomador a emissão de NFS-e trava (nfse-builder / tomadorEndereco exigem 7 dígitos).
--
-- ALTERAÇÃO DE DADO DE CLIENTE EM MASSA -> revisao-eng-chefe (CEO).
--
-- Como resolve (honesto, RD-51: não inventa — só preenche quando há match na tabela oficial):
--   * fonte: public.erp_gov_nfse_municipios (5.570 municípios, mesma tabela das RPCs fn_municipio_por_nome_uf);
--   * casa por (UF, nome do município) tolerante a acento/caixa/espaços (public.f_unaccent, já IMMUTABLE/indexada);
--   * limpa o sufixo " (UF)" que vem de importações (ex.: cidade gravada como "CHAPECO (SC)") antes de casar —
--     é o que faz a maioria dos clientes das empresas de gesso/acabamentos resolver.
--
-- Segurança (incidente 03/10 — nunca derrubar o banco): é UM UPDATE set-based com JOIN (NÃO chama função por
-- linha em volume). O trigger BEFORE de guarda de IE (fn_guard_cliente_contribuinte_ie) NÃO dispara aqui porque
-- não mexemos em contribuinte_icms nem em ie — só em codigo_ibge_municipio/updated_at.
--
-- Idempotente: só toca linhas com IBGE NULL/'' e cidade+UF resolvíveis. Quem não resolve (nome divergente,
-- sem cidade/UF) preenche sozinho depois no ClienteForm (auto-lookup ViaCEP/cidade+UF no submit) ou na emissão.
--
-- Prova (antes/depois): backup dos alvos em rls2_backup + RAISE NOTICE com as contagens no log do deploy.

-- 1) BACKUP dos alvos (snapshot ANTES) — permite reverter linha a linha se preciso.
CREATE TABLE IF NOT EXISTS rls2_backup.erp_clientes_ibge_bkp_1880 AS
SELECT c.id, c.company_id, c.cidade, c.uf,
       c.codigo_ibge_municipio AS ibge_antes, now() AS snapshot_em
  FROM public.erp_clientes c
 WHERE (c.codigo_ibge_municipio IS NULL OR btrim(c.codigo_ibge_municipio) = '')
   AND coalesce(btrim(c.cidade), '') <> ''
   AND length(btrim(coalesce(c.uf, ''))) = 2
   AND EXISTS (
     SELECT 1 FROM public.erp_gov_nfse_municipios g
      WHERE g.uf = upper(btrim(c.uf))
        AND btrim(regexp_replace(lower(public.f_unaccent(g.nome_municipio)), '\s+', ' ', 'g'))
          = btrim(regexp_replace(lower(public.f_unaccent(regexp_replace(c.cidade, '\s*\(.*\)\s*$', ''))), '\s+', ' ', 'g'))
   );

-- 2) Prova ANTES (no log do deploy).
DO $$
DECLARE v_sem int; v_alvo int;
BEGIN
  SELECT count(*) INTO v_sem FROM public.erp_clientes
   WHERE codigo_ibge_municipio IS NULL OR btrim(codigo_ibge_municipio) = '';
  SELECT count(*) INTO v_alvo FROM rls2_backup.erp_clientes_ibge_bkp_1880;
  RAISE NOTICE '[#1880] ANTES: clientes sem IBGE=% · alvos resolvíveis (backup)=%', v_sem, v_alvo;
END $$;

-- 3) BACKFILL set-based (um UPDATE). Só NULL/'' com cidade+UF que casam na tabela oficial.
UPDATE public.erp_clientes c
   SET codigo_ibge_municipio = g.codigo_ibge,
       updated_at = now()
  FROM public.erp_gov_nfse_municipios g
 WHERE (c.codigo_ibge_municipio IS NULL OR btrim(c.codigo_ibge_municipio) = '')
   AND coalesce(btrim(c.cidade), '') <> ''
   AND length(btrim(coalesce(c.uf, ''))) = 2
   AND g.uf = upper(btrim(c.uf))
   AND btrim(regexp_replace(lower(public.f_unaccent(g.nome_municipio)), '\s+', ' ', 'g'))
     = btrim(regexp_replace(lower(public.f_unaccent(regexp_replace(c.cidade, '\s*\(.*\)\s*$', ''))), '\s+', ' ', 'g'));

-- 4) Prova DEPOIS (no log do deploy).
DO $$
DECLARE v_sem int;
BEGIN
  SELECT count(*) INTO v_sem FROM public.erp_clientes
   WHERE codigo_ibge_municipio IS NULL OR btrim(codigo_ibge_municipio) = '';
  RAISE NOTICE '[#1880] DEPOIS: clientes ainda sem IBGE=% (restam os sem cidade/UF ou com nome divergente — preenchem no cadastro/emissão)', v_sem;
END $$;
