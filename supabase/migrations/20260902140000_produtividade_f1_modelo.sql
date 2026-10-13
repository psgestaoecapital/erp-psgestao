-- Módulo Produtividade Industrial · Fase 1 (só cadastro) · modelo de dados (§4).
-- Piloto Frioeste. Multi-tenant: company_id + plant_id em todas; RLS padrão
-- company_id IN (SELECT get_user_company_ids()). plant_id → industrial_plants (a planta é a unidade
-- de cadastro). Nada de cálculo aqui — Fase 2. ind_turnos é REUSADA (RD-26/RD-30), não recriada.

-- helper de trigger updated_at já existe: public.fn_update_updated_at()

-- ── 4.1 Parâmetros da planta ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prod_setor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plant_id, nome)
);

CREATE TABLE IF NOT EXISTS public.prod_cargo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plant_id, nome)
);

CREATE TABLE IF NOT EXISTS public.prod_unidade_medida (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  codigo text NOT NULL,   -- kg,cabeca,pc,gc,caixa,m3,litro,metro,ton (lista aberta)
  nome text NOT NULL,
  e_padrao_planta boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plant_id, codigo)
);

CREATE TABLE IF NOT EXISTS public.prod_tipo_posto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  codigo text NOT NULL CHECK (codigo IN ('manual','misto','automatico')),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plant_id, codigo)
);

-- prod_conversao — o que permite somar cabeça com caixa. Vigência OBRIGATÓRIA (§4.1).
CREATE TABLE IF NOT EXISTS public.prod_conversao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  unidade_origem  text NOT NULL,
  unidade_destino text NOT NULL,
  fator numeric NOT NULL CHECK (fator > 0),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  origem text NOT NULL DEFAULT 'informada' CHECK (origem IN ('medida','informada')),
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

-- ── 4.2 Turno — REUSA ind_turnos (existe e está vazia). Estende, não recria. ──
-- turno = codigo (T1|T2|T3); inicio/fim = hora_referencia; adiciona company_id/plant_id/nome/ativo.
-- data era NOT NULL (schema de instância diária); definição não tem data → torna nullable.
-- turno = 'A'|'B'|'C' por CHECK existente; a definição usa codigo próprio (T1|T2|T3) — coluna nova,
-- sem tocar no CHECK legado. inicio/fim = hora_referencia.
ALTER TABLE public.ind_turnos
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS plant_id   uuid REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS codigo text,
  ADD COLUMN IF NOT EXISTS nome text,
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
-- schema de instância diária: data + unidade_id eram NOT NULL. Definição de turno não os usa
-- (usa plant_id). Tabela vazia → torna ambos nullable (extensão segura, RD-30).
ALTER TABLE public.ind_turnos ALTER COLUMN data DROP NOT NULL;
ALTER TABLE public.ind_turnos ALTER COLUMN unidade_id DROP NOT NULL;

-- ── 4.3 Posto de trabalho ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prod_posto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  numero text NOT NULL,
  atividade text NOT NULL,
  setor_id uuid NOT NULL REFERENCES public.prod_setor(id) ON DELETE RESTRICT,
  centro_custo text,
  tipo_posto_id uuid REFERENCES public.prod_tipo_posto(id) ON DELETE SET NULL,
  supervisor_nome text,
  cargo_id uuid REFERENCES public.prod_cargo(id) ON DELETE SET NULL,
  unidade_medida_id uuid REFERENCES public.prod_unidade_medida(id) ON DELETE SET NULL,  -- o que ESTE posto conta
  capacidade_hora numeric,                                     -- NULL = ainda não medida ("a medir")
  capacidade_origem text CHECK (capacidade_origem IN ('medida','melhor_realizado')),
  alocacao text NOT NULL DEFAULT 'fixa' CHECK (alocacao IN ('fixa','rotativa')),
  ordem_linha int NOT NULL DEFAULT 0,                          -- posição na sequência do setor
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plant_id, setor_id, numero)
);

-- ── 4.4 Quadro e horário por turno — com vigência (é linha, não coluna) ────
CREATE TABLE IF NOT EXISTS public.prod_posto_turno (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  posto_id uuid NOT NULL REFERENCES public.prod_posto(id) ON DELETE CASCADE,
  turno_id uuid NOT NULL REFERENCES public.ind_turnos(id) ON DELETE RESTRICT,
  hora_entrada time,                    -- escalonado; pode diferir do turno de referência
  hora_saida time,
  pessoas numeric,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (posto_id, turno_id, vigencia_inicio),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

-- ── 4.5 Fluxo — os dois modos na mesma estrutura ──────────────────────────
CREATE TABLE IF NOT EXISTS public.prod_fluxo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  setor_id uuid NOT NULL REFERENCES public.prod_setor(id) ON DELETE RESTRICT,
  nome text NOT NULL,
  modo text NOT NULL DEFAULT 'compartilhado' CHECK (modo IN ('compartilhado','especifico')),
  produto_id uuid,                       -- NULL no modo compartilhado
  unidade_entrada_id uuid REFERENCES public.prod_unidade_medida(id) ON DELETE SET NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((modo = 'compartilhado' AND produto_id IS NULL) OR (modo = 'especifico' AND produto_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.prod_fluxo_etapa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  fluxo_id uuid NOT NULL REFERENCES public.prod_fluxo(id) ON DELETE CASCADE,
  posto_id uuid NOT NULL REFERENCES public.prod_posto(id) ON DELETE RESTRICT,
  ordem int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fluxo_id, posto_id)
);

-- ── 4.6 Tempo padrão — origem NÃO é decorativa (cronometrado × deduzido) ───
CREATE TABLE IF NOT EXISTS public.prod_tempo_padrao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  posto_id uuid NOT NULL REFERENCES public.prod_posto(id) ON DELETE CASCADE,
  produto_id uuid,
  tempo numeric NOT NULL CHECK (tempo > 0),
  unidade_tempo text NOT NULL CHECK (unidade_tempo IN ('min_por_kg','min_por_unidade')),
  origem text NOT NULL CHECK (origem IN ('cronometrado','deduzido')),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

-- ── RLS + grants + trigger updated_at para todas as prod_* ─────────────────
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prod_setor','prod_cargo','prod_unidade_medida','prod_tipo_posto',
      'prod_conversao','prod_posto','prod_posto_turno','prod_fluxo','prod_fluxo_etapa','prod_tempo_padrao']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_rw', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
        USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
        WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin())$p$, t||'_rw', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'tg_'||t||'_upd', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_update_updated_at()', 'tg_'||t||'_upd', t);
  END LOOP;
END $rls$;
