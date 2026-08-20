-- LC116 · normaliza os códigos do catálogo pro formato de subitem OFICIAL (grupo com 2 dígitos: 07.02).
-- Fronteira GE (fiscal). Alinha fiscal_codigo_catalogo(tipo='lc116') com fiscal_correlacao_servico
-- (que já usa "07.02") — assim o campo LC116 do serviço, ligado ao combobox, grava "07.02" e passa a
-- DESAMBIGUAR os 60 NBS que mapeiam >1 cClassTrib conforme o LC116 (Camada 1 · auto-cClassTrib).
--
-- Premissa auditada (RD-38): 77 códigos com grupo de 1 dígito ("1.01","7.02"); padding não gera
-- colisão (0). Idempotente: o WHERE só pega grupo de 1 dígito, então re-run não repadroniza.

UPDATE public.fiscal_codigo_catalogo
SET codigo = lpad(split_part(codigo, '.', 1), 2, '0') || '.' || split_part(codigo, '.', 2)
WHERE tipo = 'lc116' AND codigo ~ '^[0-9]\.';
