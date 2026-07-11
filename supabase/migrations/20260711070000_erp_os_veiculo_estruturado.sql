-- ============================================================
-- PR 3 — Veículo estruturado na OS (habilita o card premium do Pátio).
-- Aditivo: NÃO quebra a OS (colunas nullable; equipamento continua vivo).
-- + backfill best-effort da placa a partir do texto livre 'equipamento'.
-- + feature_catalog do Pátio = 'pronto' (corrige o selo PREVISTO).
-- ============================================================

ALTER TABLE erp_os
  ADD COLUMN IF NOT EXISTS placa   varchar(10),
  ADD COLUMN IF NOT EXISTS modelo  varchar(80),
  ADD COLUMN IF NOT EXISTS marca   varchar(60),
  ADD COLUMN IF NOT EXISTS ano     integer,
  ADD COLUMN IF NOT EXISTS km      integer,
  ADD COLUMN IF NOT EXISTS chassi  varchar(30);

-- Backfill "onde possível": extrai placa (padrão antigo ABC-1234 / ABC1234 ou
-- Mercosul ABC1D23) do texto livre 'equipamento', quando placa ainda nula.
UPDATE erp_os
SET placa = upper(regexp_replace((regexp_match(upper(equipamento), '([A-Z]{3}[- ]?[0-9][0-9A-Z][0-9]{2})'))[1], '[- ]', '', 'g'))
WHERE placa IS NULL AND equipamento IS NOT NULL
  AND upper(equipamento) ~ '[A-Z]{3}[- ]?[0-9][0-9A-Z][0-9]{2}';

-- Corrige o selo do Pátio (a tela existe/está pronta) — o sidebar lê feature_catalog.
INSERT INTO feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade)
VALUES ('feat_oficina_patio', 'oficina_patio', 'oficina', 'Pátio (Kanban)',
        'Quadro Kanban tátil da oficina — arrastar/tocar o card muda o status da OS.', 'pronto', 100, 'alta')
ON CONFLICT (id) DO UPDATE SET status='pronto', percentual_pronto=100;
