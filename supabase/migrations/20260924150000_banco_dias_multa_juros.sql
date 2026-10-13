-- CBTT0505 — Bradesco "INFORME TODOS OS CAMPOS PARA MULTA": o grupo de multa/juros só é
-- aceito quando o percentual vem ACOMPANHADO da quantidade de dias após o vencimento em que o
-- encargo passa a incidir (qtdeDiasMulta / qtdeDiasJuros no layout Cobrança Registro). Hoje a
-- config guarda apenas os percentuais (multa_pct/juros_pct) e um dias_compensacao — que é OUTRO
-- conceito (dias de compensação/liquidação, não "dias após o vencimento para o encargo começar").
-- Portanto o grupo saía incompleto e o banco rejeitava com CBTT0505.
--
-- Esta migration adiciona as DUAS colunas próprias, nuláveis, para não misturar semântica com
-- dias_compensacao. Quando não configuradas, o adapter usa o padrão sensato de 1 dia após o
-- vencimento (mantendo configurável). A R.R usa 2% de multa e 1,5% de juros — os encargos NÃO
-- podem ser dropados (o cliente perderia o direito de cobrar), então o caminho é completar o
-- grupo, não removê-lo.
--
-- Aditiva e idempotente: só ADD COLUMN IF NOT EXISTS. Nenhuma função SECURITY DEFINER nova.

ALTER TABLE public.erp_banco_provider_config
  ADD COLUMN IF NOT EXISTS dias_multa  integer,
  ADD COLUMN IF NOT EXISTS dias_juros  integer;

COMMENT ON COLUMN public.erp_banco_provider_config.dias_multa IS
  'Dias após o vencimento em que a MULTA passa a incidir (qtdeDiasMulta no boleto Bradesco). NULL → adapter usa 1.';
COMMENT ON COLUMN public.erp_banco_provider_config.dias_juros IS
  'Dias após o vencimento em que o JUROS passa a incidir (qtdeDiasJuros no boleto Bradesco). NULL → adapter usa 1.';
