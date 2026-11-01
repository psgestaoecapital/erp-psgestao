-- RD-100 (CEO 01/11, INEGOCIÁVEL) — complemento ao gate (tarefa dceaa4b0):
-- limpar os NOMES DE SISTEMAS DE TERCEIROS do BLUEPRINT VIVO (blueprint_tela_requisito).
-- Troca só o nome por termo genérico ("de mercado"/"mercado"), preservando todo o resto do texto,
-- nas 3 colunas de texto: requisito, tela_nome, evidencia_baseline.
--
-- Segurança (RD-38 provado no banco em BEGIN...ROLLBACK, só SELECT, produção intacta):
--   * backup integral ANTES de qualquer UPDATE (blueprint_tela_requisito_bkp_rd100);
--   * word-boundary (\m \M) sempre — nunca ILIKE substring cego;
--   * nomes de marca (Sienge/Conta Azul/ContaAzul/Omie/Aplix/Procore/Olist/Prevision) = case-insensitive;
--   * Senior/SIGA/Siga = case-SENSITIVE (há 13 ocorrências da palavra PT minúscula "senior" que NÃO podem ser tocadas);
--   * prova: 0 nomes de terceiro depois; mesma contagem de linhas (1706); sem "mercado · mercado".
-- NÃO altera dado de cliente: é metadado de produto (blueprint). Sensível (UPDATE em massa) -> revisao-eng-chefe.
-- Code: code-desenvolvedor-3

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

-- 1) BACKUP integral (idempotente: popula só na primeira execução, preservando o estado original)
CREATE TABLE IF NOT EXISTS public.blueprint_tela_requisito_bkp_rd100
  (LIKE public.blueprint_tela_requisito);

INSERT INTO public.blueprint_tela_requisito_bkp_rd100
SELECT * FROM public.blueprint_tela_requisito
WHERE NOT EXISTS (SELECT 1 FROM public.blueprint_tela_requisito_bkp_rd100);

-- 2) Helper de substituição genérica (one-shot; removido no fim da migration)
CREATE OR REPLACE FUNCTION public._rd100_gen(x text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE t text := x;
  ci text := '\m(Sienge|Conta Azul|ContaAzul|Omie|Aplix|Procore|Olist|Prevision)\M';
  cs text := '\m(Senior|SIGA|Siga)\M';
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;
  -- conectores (preservam a gramática): "do/da X" -> "de mercado"; "na/no X" -> "no mercado"
  t := regexp_replace(t, 'd[ao] '||ci, 'de mercado', 'gi');
  t := regexp_replace(t, 'd[ao] '||cs, 'de mercado', 'g');
  t := regexp_replace(t, 'n[ao] '||ci, 'no mercado', 'gi');
  t := regexp_replace(t, 'n[ao] '||cs, 'no mercado', 'g');
  -- frases idiomáticas do blueprint
  t := regexp_replace(t, '([Pp]aridade) '||ci, '\1 de mercado', 'g');
  t := regexp_replace(t, '([Pp]aridade) '||cs, '\1 de mercado', 'g');
  t := regexp_replace(t, 'Benchmark '||ci, 'Benchmark de mercado', 'gi');
  t := regexp_replace(t, 'Benchmark '||cs, 'Benchmark de mercado', 'g');
  -- catch-all do token restante (inclui "ref. X:", "Ref. X ·", nome dentro de tela_nome)
  t := regexp_replace(t, ci, 'mercado', 'gi');
  t := regexp_replace(t, cs, 'mercado', 'g');
  -- colapsa duplicatas geradas por nomes adjacentes ("mercado · mercado", "de mercado de mercado")
  t := regexp_replace(t, 'mercado(\s*[·›,/]\s*|\s+e\s+|\s+de\s+|\s+)mercado', 'mercado', 'g');
  t := regexp_replace(t, 'mercado(\s*[·›,/]\s*|\s+e\s+|\s+de\s+|\s+)mercado', 'mercado', 'g');
  RETURN t;
END $f$;

-- 3) Limpeza das 3 colunas (só as linhas que têm algum nome, para não reescrever o que não muda)
UPDATE public.blueprint_tela_requisito b
SET requisito          = public._rd100_gen(b.requisito),
    tela_nome          = public._rd100_gen(b.tela_nome),
    evidencia_baseline = public._rd100_gen(b.evidencia_baseline)
WHERE b.requisito          ~* '\m(Sienge|Conta Azul|ContaAzul|Omie|Aplix|Procore|Olist|Prevision)\M'
   OR b.requisito          ~  '\m(Senior|SIGA|Siga)\M'
   OR b.tela_nome          ~* '\m(Sienge|Conta Azul|ContaAzul|Omie|Aplix|Procore|Olist|Prevision)\M'
   OR b.tela_nome          ~  '\m(Senior|SIGA|Siga)\M'
   OR b.evidencia_baseline ~* '\m(Sienge|Conta Azul|ContaAzul|Omie|Aplix|Procore|Olist|Prevision)\M'
   OR b.evidencia_baseline ~  '\m(Senior|SIGA|Siga)\M';

-- 4) Trava da própria migration: aborta se sobrou QUALQUER nome de terceiro (prova RD-38 no deploy)
DO $chk$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.blueprint_tela_requisito b
  WHERE b.requisito          ~* '\m(Sienge|Conta Azul|ContaAzul|Omie|Aplix|Procore|Olist|Prevision)\M'
     OR b.requisito          ~  '\m(Senior|SIGA|Siga)\M'
     OR b.tela_nome          ~* '\m(Sienge|Conta Azul|ContaAzul|Omie|Aplix|Procore|Olist|Prevision)\M'
     OR b.tela_nome          ~  '\m(Senior|SIGA|Siga)\M'
     OR b.evidencia_baseline ~* '\m(Sienge|Conta Azul|ContaAzul|Omie|Aplix|Procore|Olist|Prevision)\M'
     OR b.evidencia_baseline ~  '\m(Senior|SIGA|Siga)\M';
  IF n > 0 THEN
    RAISE EXCEPTION 'RD-100 blueprint: ainda restam % linhas com nome de terceiro apos a limpeza', n;
  END IF;
END $chk$;

-- 5) remove o helper one-shot
DROP FUNCTION public._rd100_gen(text);
