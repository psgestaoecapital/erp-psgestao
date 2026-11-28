-- EHS · M1 Estrutura e cadastros (onda E1) — blueprint vertical 'ehs' tela_num 1
-- Requisito: "Setores, GHE, ambientes e postos: ... ambiente com faixa de temperatura e regime".
--
-- Fatia desta PR: classificação TÉRMICA do setor (ambiente) — faixa de temperatura (°C)
-- e regime de exposição. Alimenta a elegibilidade de pausas NR-36 (M9): setor de frio
-- artificial / calor sinaliza o ambiente que exige pausa térmica.
--
-- 100% ADITIVO e idempotente: 3 colunas NOVAS, todas NULL por padrão (setor existente
-- continua idêntico), CHECK só no conjunto fechado de regime, sem tocar dado de cliente.
-- compliance_setores já tem RLS multi-tenant (policy por company_id) e anon revogado;
-- coluna nova herda a mesma proteção — nenhuma policy/grant novo é necessário.

ALTER TABLE public.compliance_setores
  ADD COLUMN IF NOT EXISTS ambiente_temp_min numeric(5,2),
  ADD COLUMN IF NOT EXISTS ambiente_temp_max numeric(5,2),
  ADD COLUMN IF NOT EXISTS ambiente_regime   text;

COMMENT ON COLUMN public.compliance_setores.ambiente_temp_min IS 'EHS M1: menor temperatura típica do ambiente do setor, em °C (opcional).';
COMMENT ON COLUMN public.compliance_setores.ambiente_temp_max IS 'EHS M1: maior temperatura típica do ambiente do setor, em °C (opcional).';
COMMENT ON COLUMN public.compliance_setores.ambiente_regime   IS 'EHS M1: regime térmico do ambiente — normal | frio_artificial | calor | externo. Base para pausas NR-36 (M9).';

-- Regime: conjunto fechado, mas opcional (NULL = não classificado).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.compliance_setores'::regclass
      AND conname = 'compliance_setores_ambiente_regime_chk'
  ) THEN
    ALTER TABLE public.compliance_setores
      ADD CONSTRAINT compliance_setores_ambiente_regime_chk
      CHECK (ambiente_regime IS NULL
             OR ambiente_regime IN ('normal','frio_artificial','calor','externo'));
  END IF;

  -- Coerência da faixa: min <= max quando ambos informados.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.compliance_setores'::regclass
      AND conname = 'compliance_setores_ambiente_temp_faixa_chk'
  ) THEN
    ALTER TABLE public.compliance_setores
      ADD CONSTRAINT compliance_setores_ambiente_temp_faixa_chk
      CHECK (ambiente_temp_min IS NULL
             OR ambiente_temp_max IS NULL
             OR ambiente_temp_min <= ambiente_temp_max);
  END IF;
END $$;

-- RD-95: "?" dos campos/coluna novos da tela /dashboard/ehs/setores (em linguagem do usuário).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.setores.col_ambiente', '/dashboard/ehs/setores', 'EHS · Setores', 'Ambiente',
   'Nada a preencher aqui — a coluna mostra a faixa de temperatura e o regime térmico que você definiu no setor.',
   'Deixa visível, de relance, quais setores são de frio, calor ou ambiente externo — os que normalmente exigem pausa térmica (NR-36).',
   '−18 a −5 °C · Frio artificial',
   'Aparecer "—" significa que o setor ainda não foi classificado; abra Editar e informe a faixa e o regime.',
   'ehs', 13, 1, 'publicado'),
  ('ehs.setores.form_temperatura', '/dashboard/ehs/setores', 'EHS · Setores', 'Faixa de temperatura (°C)',
   'A menor e a maior temperatura típicas do ambiente do setor, em graus Celsius. Pode usar número negativo (ex.: câmara fria).',
   'Registra o quanto o ambiente é frio ou quente — insumo para identificar exposição ao frio/calor e a necessidade de pausas NR-36.',
   'Câmara de congelados: mínima −22 e máxima −18.',
   'Inverter os campos (mínima maior que a máxima). O sistema não salva faixa invertida.',
   'ehs', 14, 1, 'publicado'),
  ('ehs.setores.form_regime', '/dashboard/ehs/setores', 'EHS · Setores', 'Regime do ambiente',
   'O tipo de exposição térmica do setor: Normal, Frio artificial (câmaras/antecâmaras), Calor (fornos, fundição) ou Externo (a céu aberto, sujeito ao clima).',
   'Classifica o ambiente para a gestão de saúde e segurança — em especial a elegibilidade de pausas térmicas da NR-36.',
   'Setor de abate/câmaras → Frio artificial.',
   'Deixar como "Não classificado" um setor que é claramente de frio ou calor — a pausa térmica depende dessa classificação.',
   'ehs', 15, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- SÓ-DEMO: classifica os setores da "EHS Modelo - DEMO" (frigorífico) para a tela provar o
-- recurso populado (aud8/PDCA). Guardado pelo ID da empresa DEMO; só preenche onde ainda está
-- NULL (idempotente; não sobrescreve ajuste manual). Não toca nenhuma empresa real.
UPDATE public.compliance_setores s SET
  ambiente_temp_min = v.tmin, ambiente_temp_max = v.tmax, ambiente_regime = v.regime
FROM (VALUES
  ('abate',          10::numeric,  16::numeric, 'frio_artificial'),
  ('camara-fria',   -22::numeric, -18::numeric, 'frio_artificial'),
  ('desossa',         8::numeric,  12::numeric, 'frio_artificial'),
  ('embalagem',       8::numeric,  14::numeric, 'frio_artificial'),
  ('administrativo', 20::numeric,  24::numeric, 'normal'),
  ('manutencao',     18::numeric,  28::numeric, 'normal')
) AS v(slug, tmin, tmax, regime)
WHERE s.company_id = 'b0700000-0000-4000-a000-00000000000b'
  AND s.slug = v.slug
  AND s.ambiente_regime IS NULL
  AND s.ambiente_temp_min IS NULL
  AND s.ambiente_temp_max IS NULL;
