-- #87 (Frioeste · compliance) — pré-cadastro de prestador pelo setor de Compras/Manutenção.
-- Fase 1: capturar o que a automação de NRs vai consumir (fase 2). Campos NOVOS em
-- compliance_prestadores, todos opcionais (o cadastro parcial continua valendo — só
-- company_id/razao_social/cnpj são NOT NULL):
--   • local_servico          — onde o serviço será executado
--   • classificacao_servico  — 'fixo' | 'eventual'
--   • tipos_servico[]        — manutenção, montagem/instalação, construção civil, carga/descarga, transporte
--   • atividades_especiais[] — altura, espaço confinado, eletricidade, trabalho a quente, içamento, escavação, máquinas
-- Fase 2 (depois): derivar as NRs a partir de tipos_servico + atividades_especiais e gerar
-- link para o terceiro anexar a documentação.

ALTER TABLE public.compliance_prestadores
  ADD COLUMN IF NOT EXISTS local_servico          text,
  ADD COLUMN IF NOT EXISTS classificacao_servico  text,
  ADD COLUMN IF NOT EXISTS tipos_servico          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS atividades_especiais   text[] NOT NULL DEFAULT '{}';

-- classificacao_servico aceita só fixo/eventual (ou NULL, no pré-cadastro parcial).
ALTER TABLE public.compliance_prestadores
  DROP CONSTRAINT IF EXISTS compliance_prestadores_classificacao_servico_chk;
ALTER TABLE public.compliance_prestadores
  ADD CONSTRAINT compliance_prestadores_classificacao_servico_chk
  CHECK (classificacao_servico IS NULL OR classificacao_servico IN ('fixo','eventual'));

COMMENT ON COLUMN public.compliance_prestadores.local_servico IS 'Local de execução do serviço (pré-cadastro #87).';
COMMENT ON COLUMN public.compliance_prestadores.classificacao_servico IS 'fixo | eventual (pré-cadastro #87).';
COMMENT ON COLUMN public.compliance_prestadores.tipos_servico IS 'Tipos de serviço executado — base para derivar NRs na fase 2 (#87).';
COMMENT ON COLUMN public.compliance_prestadores.atividades_especiais IS 'Atividades especiais (altura, confinado, eletricidade, etc.) — base para NRs na fase 2 (#87).';
