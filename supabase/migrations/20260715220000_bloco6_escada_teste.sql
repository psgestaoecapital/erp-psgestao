-- BLOCO 6 · Escada de teste REAL da conexão bancária (isolada da receita)
-- ============================================================================
-- Decisão do CEO (evidência dupla — banco + código): o título de teste de R$1
-- NÃO entra em erp_receber. O flag "tipo=teste_homologacao" obrigaria a corrigir
-- ~40 funções SQL + ~8 leituras no frontend — um esquecido = R$1 fantasma no DRE
-- (o vetor de sujeira que passamos o dia matando). A tabela isolada abaixo entrega
-- o mesmo objetivo POR CONSTRUÇÃO: a receita real (erp_receber/DRE/KPI/fluxo) nunca
-- sabe que o título de teste existiu. Zero filtro a lembrar.
--
-- O boleto de teste NASCE e MORRE aqui. Pagador = a PRÓPRIA empresa (nunca cliente
-- real). Degrau 5 (baixa) prova-se perguntando ao BANCO se o R$1 foi pago
-- (consultarBoleto por nosso_numero) — fonte da verdade é o banco, não nossa
-- conciliação. Nasce 'aguardando_pagamento', vira 'ok' só quando o banco confirma.
-- ============================================================================

-- 1) Tabela isolada (espelho mínimo p/ registrar o boleto de teste)
CREATE TABLE IF NOT EXISTS public.erp_banco_teste_titulo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  provider              text NOT NULL,
  banco_codigo          text,
  ambiente              text NOT NULL,
  valor                 numeric NOT NULL DEFAULT 1.00,
  pagador_nome          text,          -- a PRÓPRIA empresa
  pagador_documento     text,          -- CNPJ da própria empresa
  seu_numero            text,
  data_emissao          date,
  data_vencimento       date,
  boleto_status         text NOT NULL DEFAULT 'pendente', -- pendente | registrado | liquidado
  boleto_nosso_numero   text,
  boleto_linha_digitavel text,
  boleto_codigo_barras  text,
  boleto_qr_code        text,
  boleto_pdf_ok         boolean NOT NULL DEFAULT false,
  liquidado_em          timestamptz,
  valor_pago            numeric,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.erp_banco_teste_titulo IS
  'BLOCO 6: títulos de teste de homologação bancária (R$1, pagador=própria empresa). ISOLADO de erp_receber — nunca entra no DRE/KPI/fluxo/A Receber. Boleto de teste nasce e morre aqui.';

-- Idempotência (guarda do CEO): no máximo UM título de teste pendente
-- (não-liquidado) por empresa+provider. A escada REUSA esse título, nunca gera
-- um 2º boleto de R$1.
CREATE UNIQUE INDEX IF NOT EXISTS uq_teste_titulo_pendente
  ON public.erp_banco_teste_titulo(company_id, provider)
  WHERE boleto_status <> 'liquidado';

-- 2) Idempotência do RESULTADO da escada: 1 linha por (empresa, provider, passo).
-- Permite UPSERT (re-rodar a escada sobrescreve o resultado do degrau).
CREATE UNIQUE INDEX IF NOT EXISTS uq_teste_resultado_passo
  ON public.erp_banco_teste_resultado(company_id, provider, passo);

-- 3) RLS: cada empresa só vê os próprios títulos de teste
ALTER TABLE public.erp_banco_teste_titulo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_teste_titulo_select ON public.erp_banco_teste_titulo;
CREATE POLICY p_teste_titulo_select ON public.erp_banco_teste_titulo
  FOR SELECT USING (company_id IN (SELECT public.get_user_company_ids()));

-- Escrita é só via service_role (o orquestrador server-side). Sem policy de
-- INSERT/UPDATE p/ authenticated: a tabela não é editável pela tela.

GRANT SELECT ON public.erp_banco_teste_titulo TO authenticated;
GRANT ALL    ON public.erp_banco_teste_titulo TO service_role;
