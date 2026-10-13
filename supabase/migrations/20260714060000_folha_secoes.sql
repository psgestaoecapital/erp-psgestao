-- FIX 3 · guarda do 13º. Registra QUAIS seções de cálculo entraram na competência
-- (ex.: "Folha Mensal" vs "Folha Mensal, 13º Salário"). Aditivo. O gestor precisa
-- ver por que dezembro custou 2×. A SOMA por matrícula é feita no parser (nunca sobrescreve).
ALTER TABLE public.folha_competencia ADD COLUMN IF NOT EXISTS secoes text;
