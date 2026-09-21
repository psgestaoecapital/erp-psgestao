-- Revenda · correção do NCM das motos (TIPI 8711.20) — genérico, por tabela (RD-65/RD-51).
--
-- O seed anterior (20260921370000) usava 87112090 para toda a faixa 50–250 cc; mas 87112090 é o subitem
-- "outros" (ciclomotores etc.) do 8711.20, e uma motocicleta cai em 8711.20.10 (≤125 cc) ou 8711.20.20
-- (>125 cc). Sem a divisão, uma CG 160 / Fazer 250 sairia como "outros". Conferido na TIPI pelo Eng. Chefe:
--   8711.20.10  motocicleta ≤ 125 cc          → 87112010
--   8711.20.20  motocicleta > 125 até 250 cc   → 87112020
--   8711.20.90  outros (ciclomotores etc.)     → 87112090  (não é motocicleta → tipo próprio 'ciclomotor')
--   8711.60.00  moto com motor elétrico        → 87116000  (linha por combustível — vence a faixa por cc)
--   8711.90.00  outros                          → 87119000  (tipo 'moto_outros')
--
-- Convenção da fn_veic_ncm_sugerido: cilindrada_min ≤ cc < cilindrada_max (teto EXCLUSIVO). Por isso os
-- tetos são o limite superior + 1 (…126 ⇒ inclui 125; …251 ⇒ inclui 250), casando com as faixas da TIPI.
-- Aditivo de DADO (RD-55/RD-52): só reescreve as linhas da família moto; carros ficam intactos. A NF-e de
-- veículo ainda não existe (D2), então isto não altera nota emitida hoje — corrige a fonte para quando existir.

DELETE FROM veic_ncm_faixa
 WHERE tipo IN ('moto','ciclomotor','moto_outros') AND ncm LIKE '8711%';

INSERT INTO veic_ncm_faixa (tipo, combustivel, cilindrada_min, cilindrada_max, lugares_min, lugares_max, ncm) VALUES
  -- motocicletas 8711 por cilindrada (teto exclusivo: 51→inclui ≥51, 126→inclui até 125, 251→até 250, …)
  ('moto',      NULL, 0,   51,   NULL, NULL, '87111000'),   -- 8711.10.00  ≤ 50 cc
  ('moto',      NULL, 51,  126,  NULL, NULL, '87112010'),   -- 8711.20.10  51–125 cc
  ('moto',      NULL, 126, 251,  NULL, NULL, '87112020'),   -- 8711.20.20  126–250 cc
  ('moto',      NULL, 251, 501,  NULL, NULL, '87113000'),   -- 8711.30.00  251–500 cc
  ('moto',      NULL, 501, 801,  NULL, NULL, '87114000'),   -- 8711.40.00  501–800 cc
  ('moto',      NULL, 801, NULL, NULL, NULL, '87115000'),   -- 8711.50.00  > 800 cc
  ('moto', 'eletrico', 0,  NULL, NULL, NULL, '87116000'),   -- 8711.60.00  motor elétrico (qualquer cilindrada)
  -- "outros" da TIPI: não são motocicleta comum — tipos próprios para não roubar a sugestão da moto.
  ('ciclomotor',  NULL, 0, NULL, NULL, NULL, '87112090'),   -- 8711.20.90  ciclomotores / outros do 8711.20
  ('moto_outros', NULL, 0, NULL, NULL, NULL, '87119000')    -- 8711.90.00  outros
ON CONFLICT DO NOTHING;
