-- OFICINA · Mecânica pesada e frota — Ondas 9.1 (a unidade) + 9.2 (próprio × terceiro), FUNDAÇÃO DE DADOS.
-- SPEC_oficina_pesada_ondas_2 (RD-41). O gatilho da Onda 9 (adiada) disparou: cliente de pesado fechado 15/09.
--
-- 🔒 TRAVAS (valem mais que o código):
--   • A KGF NÃO PODE QUEBRAR: erp_os.unidade_id é OPCIONAL (nullable). OS com placa e sem unidade segue igual.
--   • Genericidade: tipo de unidade, eixos, medidor são cadastro por empresa — nunca enum fixo, nunca nome de cliente.
--   • Fronteira (c2869c85): a Oficina dispara evento; quem escreve em erp_pagar/erp_receber é a GE. Aqui só o DADO.
-- Esta migration NÃO altera nenhuma tela (revelação progressiva vem no PR da tela) — logo, tela idêntica à de hoje.

-- Predicado multi-tenant igual ao da erp_os (company-scope + bypass de admin PS)
-- (inline nas policies abaixo)

-- 1) Catálogo de tipos de unidade — de fábrica (company_id NULL = global) + por empresa. Editável, não enum.
CREATE TABLE IF NOT EXISTS public.erp_unidade_tipo (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,                       -- NULL = tipo de fábrica (global)
  codigo     text NOT NULL,
  rotulo     text NOT NULL,
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_unidade_tipo_global ON public.erp_unidade_tipo (codigo) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_unidade_tipo_empresa ON public.erp_unidade_tipo (company_id, codigo) WHERE company_id IS NOT NULL;
ALTER TABLE public.erp_unidade_tipo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unidade_tipo_read ON public.erp_unidade_tipo;
CREATE POLICY unidade_tipo_read ON public.erp_unidade_tipo FOR SELECT USING (
  company_id IS NULL
  OR company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.users WHERE users.id=auth.uid() AND users.role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))
);
INSERT INTO public.erp_unidade_tipo (company_id, codigo, rotulo) VALUES
  (NULL,'cavalo','Cavalo mecânico'),(NULL,'carreta','Carreta'),(NULL,'truck','Truck'),(NULL,'toco','Toco'),
  (NULL,'bitrem','Bitrem'),(NULL,'implemento','Implemento'),(NULL,'maquina_agricola','Máquina agrícola'),
  (NULL,'linha_amarela','Linha amarela'),(NULL,'utilitario','Utilitário'),(NULL,'leve','Veículo leve')
ON CONFLICT DO NOTHING;

-- 2) A frota (o dono). cliente_id IS NULL = FROTA PRÓPRIA (o discriminador da 9.2).
CREATE TABLE IF NOT EXISTS public.erp_frota (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  nome       text NOT NULL,
  cliente_id uuid REFERENCES public.erp_clientes(id),   -- NULL = frota própria da empresa
  contato    text,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.erp_frota.cliente_id IS 'NULL = frota própria (OS vira custo, não fatura). Preenchido = frota de terceiro (OS fatura).';

-- 3) A unidade (o que entra na oficina). KM × horímetro por medidor_tipo.
CREATE TABLE IF NOT EXISTS public.erp_unidade (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  frota_id      uuid NOT NULL REFERENCES public.erp_frota(id),
  numero_interno text,
  placa         text,
  tipo          text,                                   -- codigo de erp_unidade_tipo (por empresa), nunca enum fixo
  marca         text, modelo text, ano integer,
  config_eixos  text,                                   -- ex.: '6x2' (define o mapa de posições de pneu na 9.3)
  chassi        text, renavam text,
  medidor_tipo  text NOT NULL DEFAULT 'km' CHECK (medidor_tipo IN ('km','horimetro','ambos')),
  medidor_atual numeric,
  medidor_atualizado_em timestamptz,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_unidade_frota ON public.erp_unidade(frota_id);
CREATE INDEX IF NOT EXISTS ix_unidade_company ON public.erp_unidade(company_id);

-- 4) O conjunto (cavalo + carreta). O histórico segue a UNIDADE, não o conjunto.
CREATE TABLE IF NOT EXISTS public.erp_unidade_conjunto (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL,
  unidade_tratora_id  uuid NOT NULL REFERENCES public.erp_unidade(id),
  unidade_rebocada_id uuid NOT NULL REFERENCES public.erp_unidade(id),
  desde              date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  ate                date,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 5) A OS ganha unidade OPCIONAL (a KGF não quebra: nullable, sem trigger novo, sem default).
ALTER TABLE public.erp_os ADD COLUMN IF NOT EXISTS unidade_id uuid REFERENCES public.erp_unidade(id);

-- RLS company-scope (igual à erp_os) para as três tabelas operacionais
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['erp_frota','erp_unidade','erp_unidade_conjunto'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_all', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL USING (
        company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.users WHERE users.id=auth.uid() AND users.role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))
      )$p$, t||'_all', t);
  END LOOP;
END $$;

-- 6) O discriminador da 9.2 — read-only. A tela usa para SUMIR o botão de faturar quando é frota própria.
--    A Oficina NÃO escreve financeiro; isto só CLASSIFICA o destino do dinheiro.
CREATE OR REPLACE FUNCTION public.fn_os_destino_financeiro(p_os_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN o.unidade_id IS NULL THEN 'faturar'                    -- OS comum (KGF): fatura como hoje
    WHEN f.cliente_id IS NULL THEN 'custo_frota_propria'        -- frota própria: vira custo, NÃO fatura
    ELSE 'faturar'                                              -- frota de terceiro: fatura
  END
  FROM public.erp_os o
  LEFT JOIN public.erp_unidade u ON u.id = o.unidade_id
  LEFT JOIN public.erp_frota f   ON f.id = u.frota_id
  WHERE o.id = p_os_id;
$$;
GRANT EXECUTE ON FUNCTION public.fn_os_destino_financeiro(uuid) TO authenticated, service_role;

-- 7) RPCs de cadastro/listagem (a tela da 9.1/9.2 usa; SECURITY DEFINER com escopo por company do chamador)
CREATE OR REPLACE FUNCTION public.fn_frota_criar(p_company_id uuid, p_nome text, p_cliente_id uuid DEFAULT NULL, p_contato text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT company_id FROM public.user_companies WHERE user_id=auth.uid())
          OR EXISTS (SELECT 1 FROM public.users WHERE id=auth.uid() AND role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))) THEN
    RAISE EXCEPTION 'sem_acesso_a_empresa';
  END IF;
  INSERT INTO public.erp_frota(company_id,nome,cliente_id,contato) VALUES (p_company_id,p_nome,p_cliente_id,p_contato) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_frota_criar(uuid,text,uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_unidade_criar(
  p_company_id uuid, p_frota_id uuid, p_placa text DEFAULT NULL, p_tipo text DEFAULT NULL,
  p_numero_interno text DEFAULT NULL, p_medidor_tipo text DEFAULT 'km')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT company_id FROM public.user_companies WHERE user_id=auth.uid())
          OR EXISTS (SELECT 1 FROM public.users WHERE id=auth.uid() AND role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))) THEN
    RAISE EXCEPTION 'sem_acesso_a_empresa';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_frota WHERE id=p_frota_id AND company_id=p_company_id) THEN
    RAISE EXCEPTION 'frota_invalida';
  END IF;
  INSERT INTO public.erp_unidade(company_id,frota_id,placa,tipo,numero_interno,medidor_tipo)
    VALUES (p_company_id,p_frota_id,p_placa,p_tipo,p_numero_interno,COALESCE(p_medidor_tipo,'km')) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.fn_unidade_criar(uuid,uuid,text,text,text,text) TO authenticated, service_role;
