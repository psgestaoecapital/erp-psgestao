-- IBPT centralizado (Lei 12.741) — PR 1/4: tabela GLOBAL + RLS (decisão do CEO 23/09, SPEC aprovada).
-- A tabela IBPT é ÚNICA (alíquotas por NCM×UF, iguais para todas as empresas), carregada UMA vez e
-- usada por todos os tenants — como Omie/Senior. Por isso é NÚCLEO: SEM company_id (igual ao template
-- de plano de contas). O token do IBPT só serviria para BAIXAR a tabela; a API está fora do ar, então
-- a carga é por importação de arquivo (PR 2). Fonte da doutrina: deolhonoimposto.ibpt.org.br (manual
-- do desenvolvedor) + doc Senior ("a tabela IBPT é única e será utilizada por todas as empresas").
--
-- Chave: (ncm, uf, versao) — permite manter versões (histórico de vigência) lado a lado. A versão
-- vigente é escolhida no cálculo (PR 3) por vigencia_inicio/fim. ex_tipi/tipo/descricao/chave_ibpt
-- vêm do arquivo do IBPT (colunas a confirmar contra o arquivo real no importador).
--
-- Só tabela + RLS + índice — NÃO é SECURITY DEFINER (fora do gate check:fn-guards). RD-52.

CREATE TABLE IF NOT EXISTS public.fiscal_ibpt_aliquota (
  ncm                        text        NOT NULL,             -- código NCM (8 díg.) ou NBS, conforme o arquivo
  uf                         text        NOT NULL,             -- UF de consumo (destinatário). "EX" p/ exterior
  aliquota_nacional_federal  numeric     NOT NULL DEFAULT 0,   -- % federal p/ produto NACIONAL
  aliquota_importado_federal numeric     NOT NULL DEFAULT 0,   -- % federal p/ produto IMPORTADO
  aliquota_estadual          numeric     NOT NULL DEFAULT 0,   -- % estadual
  aliquota_municipal         numeric     NOT NULL DEFAULT 0,   -- % municipal
  ex_tipi                    text,                             -- "ex" da TIPI (quando houver)
  tipo                       text,                             -- 0=NCM · 1=NBS · 2=LC116 (conforme IBPT)
  descricao                  text,
  versao                     text        NOT NULL,             -- versão da tabela IBPT (ex.: "26.1.C")
  vigencia_inicio            date        NOT NULL,
  vigencia_fim               date        NOT NULL,
  fonte                      text,                             -- ex.: "IBPT/empresometro"
  chave_ibpt                 text,                             -- chave do registro no arquivo IBPT
  importado_em               timestamptz NOT NULL DEFAULT now(),
  importado_por              text,
  CONSTRAINT pk_fiscal_ibpt_aliquota PRIMARY KEY (ncm, uf, versao)
);

COMMENT ON TABLE public.fiscal_ibpt_aliquota IS
  'Tabela IBPT (Lei 12.741) GLOBAL — alíquotas aproximadas por NCM×UF, únicas para todos os tenants '
  '(núcleo, sem company_id). Carregada por importação (Central de Dev, PR 2). A API do IBPT está fora do ar.';

-- Busca do cálculo (PR 3): NCM + UF na versão vigente.
CREATE INDEX IF NOT EXISTS ix_fiscal_ibpt_ncm_uf_vig
  ON public.fiscal_ibpt_aliquota (ncm, uf, vigencia_inicio, vigencia_fim);

-- RLS: dado de referência PÚBLICO — leitura para qualquer usuário AUTENTICADO; SEM anon.
-- Escrita: nenhuma policy para 'authenticated' (negado) — a carga entra via service_role no importador
-- server-side (RD-30: cliente não cadastra nada; só o núcleo PS carrega).
ALTER TABLE public.fiscal_ibpt_aliquota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_ibpt_select_auth ON public.fiscal_ibpt_aliquota;
CREATE POLICY fiscal_ibpt_select_auth
  ON public.fiscal_ibpt_aliquota
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON public.fiscal_ibpt_aliquota FROM anon;
GRANT SELECT ON public.fiscal_ibpt_aliquota TO authenticated;
GRANT ALL ON public.fiscal_ibpt_aliquota TO service_role;
