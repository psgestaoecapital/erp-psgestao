-- IBPT por empresa (CEO 28/09, versão essencial por prazo): cada empresa cadastra o SEU token da API "De Olho no
-- Imposto" (Configurações › Fiscal). O token vai para o Vault pelo cofre de credenciais da PR E
-- (erp_credencial provider='ibpt', chave='token'); aqui só o CACHE das respostas e o STATUS do token.
--
-- Cache: por empresa + tipo (produto/servico) + código + EX + UF, com a versão e a vigência que o IBPT devolveu
-- (campos Versao/VigenciaInicio/VigenciaFim da especificação oficial deolhonoimposto.ibpt.org.br/Content/
-- apideolhonoimposto.json). Vale até a VigenciaFim — depois disso a próxima nota consulta de novo.
-- Uso nas notas: DESLIGADO por padrão (ibpt_empresa_nas_notas=false) até o CEO conferir, na 1ª consulta real
-- (KGF), o significado de Nacional/Importado/Estadual/Municipal. Reserva: tabela genérica (fiscal_ibpt_aliquota).

CREATE TABLE IF NOT EXISTS public.erp_ibpt_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('produto','servico')),
  codigo          text NOT NULL,
  ex              integer NOT NULL DEFAULT 0,
  uf              text NOT NULL,
  descricao       text,
  nacional        numeric,
  importado       numeric,
  estadual        numeric,
  municipal       numeric,
  tipo_ibpt       text,
  versao          text,
  vigencia_inicio date,
  vigencia_fim    date,
  chave           text,
  fonte           text,
  resposta        jsonb,
  consultado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, tipo, codigo, ex, uf)
);
ALTER TABLE public.erp_ibpt_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_ibpt_cache FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.erp_ibpt_empresa_status (
  company_id           uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  token_salvo_em       timestamptz,
  ultima_consulta_ok   timestamptz,
  ultimo_erro_em       timestamptz,
  ultimo_erro          text,
  ultima_versao        text,
  ultima_vigencia_fim  date,
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_ibpt_empresa_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_ibpt_empresa_status FROM PUBLIC, anon, authenticated;

ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS ibpt_empresa_nas_notas boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.erp_fiscal_provider_config.ibpt_empresa_nas_notas IS
  'Usa a consulta IBPT da própria empresa (token) nas notas antes da tabela genérica. Desligado até o CEO conferir o significado dos campos na 1ª consulta real.';

-- fonte dos tributos aproximados que foi em cada nota: 'ibpt_empresa' | 'tabela_generica' (NF-e pode ter as duas)
ALTER TABLE public.erp_nfse_emitidas ADD COLUMN IF NOT EXISTS ibpt_fonte text;
ALTER TABLE public.erp_nfe_emitidas  ADD COLUMN IF NOT EXISTS ibpt_fonte text;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ibpt_cache') THEN
    RAISE EXCEPTION 'erp_ibpt_cache não criada';
  END IF;
END $do$;
