-- #9427 / pedido Canal PS (jordana-chat): ISS por município de EXECUÇÃO do serviço.
-- Fatia 1 (backend, ADITIVA): tabela GLOBAL de referência de alíquota de ISS por
-- município (código IBGE) x subitem da LC 116, independente de empresa.
--
-- Contexto: fiscal_iss_municipio é POR EMPRESA (company_id) e hoje tem só linhas
-- manuais (fonte 'contador'). Para a nota com ISS retido no município da execução, a
-- alíquota precisa ser a do município onde o serviço é prestado — isso é informação
-- pública (nacional), não um dado do cliente. Esta tabela global guarda essa referência,
-- alimentada pela rotina de consulta ao Sistema Nacional NFS-e (fatias seguintes) e por
-- cadastro manual validado pelo contador quando o município não tem fonte oficial.
--
-- Mesma doutrina das demais tabelas globais de referência fiscal (fiscal_ibpt_aliquota,
-- erp_gov_nfse_municipios): sem company_id, RLS ligada, leitura para autenticado,
-- escrita só pela conexão de serviço (cron/RPC guardada), REVOKE para anon.
-- Idempotente e aditiva: não toca em nenhuma linha existente de cliente.

CREATE TABLE IF NOT EXISTS public.fiscal_iss_municipio_aliquota (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_ibge     text NOT NULL,                 -- código IBGE do município de execução (7 díg.)
  codigo_lc116    text NOT NULL,                  -- subitem da LC 116 (ex.: '07.05')
  aliquota        numeric(7,4) NOT NULL CHECK (aliquota >= 0 AND aliquota <= 100),
  retido_na_fonte boolean,                        -- NULL = não informado pela fonte
  vigencia_inicio date NOT NULL DEFAULT current_date,
  vigencia_fim    date,
  fonte           text NOT NULL CHECK (fonte IN ('api_nacional','prefeitura','contador')),
  consultado_em   timestamptz,                    -- quando a fonte foi consultada (API/prefeitura)
  status_validacao text NOT NULL DEFAULT 'pendente'
                    CHECK (status_validacao IN ('pendente','validada','sem_fonte_oficial')),
  observacao      text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

COMMENT ON TABLE public.fiscal_iss_municipio_aliquota IS
  'Referência GLOBAL (sem empresa) de alíquota de ISS por município de execução (código IBGE) x subitem LC 116. Alimentada pela consulta ao Sistema Nacional NFS-e e por cadastro manual validado pelo contador. Só alíquota com status_validacao=validada deve ir para a nota.';
COMMENT ON COLUMN public.fiscal_iss_municipio_aliquota.codigo_ibge IS 'Código IBGE do município de execução do serviço (7 dígitos).';
COMMENT ON COLUMN public.fiscal_iss_municipio_aliquota.codigo_lc116 IS 'Subitem da Lista de Serviços da LC 116/2003 (ex.: 07.05).';
COMMENT ON COLUMN public.fiscal_iss_municipio_aliquota.fonte IS 'Origem da alíquota: api_nacional (Sistema Nacional NFS-e), prefeitura ou contador (cadastro manual).';
COMMENT ON COLUMN public.fiscal_iss_municipio_aliquota.status_validacao IS 'pendente | validada | sem_fonte_oficial. Nada vai para nota sem alíquota validada.';

-- Uma alíquota vigente por (município x subitem x início de vigência).
CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_iss_mun_aliquota_vig
  ON public.fiscal_iss_municipio_aliquota (codigo_ibge, codigo_lc116, vigencia_inicio);

-- Busca da alíquota na emissão (município + subitem).
CREATE INDEX IF NOT EXISTS ix_fiscal_iss_mun_aliquota_lookup
  ON public.fiscal_iss_municipio_aliquota (codigo_ibge, codigo_lc116);

ALTER TABLE public.fiscal_iss_municipio_aliquota ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer usuário autenticado (dado de referência público).
DROP POLICY IF EXISTS fiscal_iss_mun_aliquota_select_auth ON public.fiscal_iss_municipio_aliquota;
CREATE POLICY fiscal_iss_mun_aliquota_select_auth
  ON public.fiscal_iss_municipio_aliquota
  FOR SELECT TO authenticated
  USING (true);

-- Escrita somente pela conexão de serviço (cron/RPC guardada). service_role ignora RLS;
-- authenticated NÃO tem policy de escrita, então INSERT/UPDATE/DELETE pela sessão do
-- usuário ficam bloqueados por padrão.

REVOKE ALL ON public.fiscal_iss_municipio_aliquota FROM anon;
GRANT SELECT ON public.fiscal_iss_municipio_aliquota TO authenticated;
GRANT ALL ON public.fiscal_iss_municipio_aliquota TO service_role;

-- Mantém atualizado_em em cada escrita.
CREATE OR REPLACE FUNCTION public.fn_fiscal_iss_mun_aliquota_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fiscal_iss_mun_aliquota_touch ON public.fiscal_iss_municipio_aliquota;
CREATE TRIGGER trg_fiscal_iss_mun_aliquota_touch
  BEFORE UPDATE ON public.fiscal_iss_municipio_aliquota
  FOR EACH ROW EXECUTE FUNCTION public.fn_fiscal_iss_mun_aliquota_touch();

REVOKE ALL ON FUNCTION public.fn_fiscal_iss_mun_aliquota_touch() FROM PUBLIC, anon;
