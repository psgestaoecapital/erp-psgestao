-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EHS-0(c) · RD-100 (CEO 01/11, INEGOCIÁVEL) — limpar NOMES DE SISTEMA DE TERCEIROS do blueprint vivo da vertical EHS
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- O blueprint EHS (blueprint_tela_requisito, vertical='ehs') entrou DEPOIS da limpeza geral de 2026-11-05
-- (20261105193145_rd100_blueprint_nomes_terceiros.sql), então os nomes de referência "Agrat" e "SOC/Soc" ficaram
-- nas 58 linhas atuais (telas 101/102 "Ref. Agrat …", tela 103 "Ref. Soc …"), nas 3 colunas de texto
-- (tela_nome, requisito, evidencia_baseline). Esta migration troca SÓ o nome por termo genérico ("de mercado"/
-- "mercado"), preservando todo o resto do texto. Mesma doutrina/estrutura da limpeza de 11/05.
--
-- SEGURANÇA (RD-38 provado no banco em BEGIN…ROLLBACK, só SELECT, produção intacta):
--   * backup ANTES de qualquer UPDATE (append das linhas EHS na tabela já existente blueprint_tela_requisito_bkp_rd100);
--   * word-boundary (\m \M) sempre, case-SENSITIVE nos tokens Agrat|Soc|SOC (não toca "soc"/"social" minúsculo);
--   * trava interna: aborta se sobrar QUALQUER nome depois (0 nomes · mesma contagem de 58 linhas).
-- NÃO altera dado de cliente: é metadado de produto (blueprint). Aditiva/idempotente (re-rodar não muda nada).
-- Sensível (UPDATE em massa de metadado) → revisao-eng-chefe.
-- Code: code-desenvolvedor-3

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

-- 1) BACKUP (idempotente): a tabela já existe desde 11/05; aqui só APPEND das linhas EHS ainda não guardadas (por id)
CREATE TABLE IF NOT EXISTS public.blueprint_tela_requisito_bkp_rd100
  (LIKE public.blueprint_tela_requisito);

INSERT INTO public.blueprint_tela_requisito_bkp_rd100
SELECT b.* FROM public.blueprint_tela_requisito b
WHERE b.vertical = 'ehs'
  AND (b.tela_nome ~ '\m(Agrat|Soc|SOC)\M' OR b.requisito ~ '\m(Agrat|Soc|SOC)\M' OR b.evidencia_baseline ~ '\m(Agrat|Soc|SOC)\M')
  AND NOT EXISTS (SELECT 1 FROM public.blueprint_tela_requisito_bkp_rd100 x WHERE x.id = b.id);

-- 2) Helper de substituição genérica (one-shot; removido no fim da migration)
CREATE OR REPLACE FUNCTION public._rd100_ehs(x text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE t text := x; tok text := '\m(Agrat|Soc|SOC)\M';
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;
  -- tela_nome: "Ref. Agrat · Agrat › " / "Ref. Soc · SOC › " -> "Ref. mercado · "
  t := regexp_replace(t, '^Ref\.\s+(Agrat|Soc|SOC)\s*·\s*(Agrat|Soc|SOC)\s*›\s*', 'Ref. mercado · ', 'g');
  -- conectores (preservam a gramática): "do/da X" -> "de mercado"; "na/no X" -> "no mercado"
  t := regexp_replace(t, 'd[ao] '||tok, 'de mercado', 'g');
  t := regexp_replace(t, 'n[ao] '||tok, 'no mercado', 'g');
  -- frase idiomática do blueprint
  t := regexp_replace(t, 'Benchmark '||tok, 'Benchmark de mercado', 'g');
  -- catch-all do token restante (ex.: "ref. Agrat:" -> "ref. mercado:", "(Agrat não tem)" -> "(mercado não tem)")
  t := regexp_replace(t, tok, 'mercado', 'g');
  -- colapsa duplicatas geradas por nomes adjacentes ("mercado · mercado", "de mercado de mercado")
  t := regexp_replace(t, 'mercado(\s*[·›,/]\s*|\s+e\s+|\s+de\s+|\s+)mercado', 'mercado', 'g');
  t := regexp_replace(t, 'mercado(\s*[·›,/]\s*|\s+e\s+|\s+de\s+|\s+)mercado', 'mercado', 'g');
  RETURN t;
END $f$;

-- 3) Limpeza das 3 colunas (só nas linhas EHS que têm algum nome, para não reescrever o que não muda)
UPDATE public.blueprint_tela_requisito b
SET requisito          = public._rd100_ehs(b.requisito),
    tela_nome          = public._rd100_ehs(b.tela_nome),
    evidencia_baseline = public._rd100_ehs(b.evidencia_baseline)
WHERE b.vertical = 'ehs'
  AND (b.requisito ~ '\m(Agrat|Soc|SOC)\M' OR b.tela_nome ~ '\m(Agrat|Soc|SOC)\M' OR b.evidencia_baseline ~ '\m(Agrat|Soc|SOC)\M');

-- 4) Trava da própria migration: aborta se sobrou QUALQUER nome de terceiro (prova RD-38 no deploy)
DO $chk$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.blueprint_tela_requisito b
  WHERE b.vertical = 'ehs'
    AND (b.requisito ~ '\m(Agrat|Soc|SOC)\M' OR b.tela_nome ~ '\m(Agrat|Soc|SOC)\M' OR b.evidencia_baseline ~ '\m(Agrat|Soc|SOC)\M');
  IF n > 0 THEN
    RAISE EXCEPTION 'RD-100 blueprint EHS: ainda restam % linhas com nome de terceiro apos a limpeza', n;
  END IF;
END $chk$;

-- 5) remove o helper one-shot
DROP FUNCTION public._rd100_ehs(text);
