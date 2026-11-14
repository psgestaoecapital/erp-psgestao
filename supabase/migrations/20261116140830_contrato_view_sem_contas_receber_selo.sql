-- #2de35307 — Selo "Sem contas a receber" + botão "Gerar agora" no Contrato.
-- Correção do AJUSTES do revisor (PR #4948): a view v_contratos_dashboard não
-- expunha a coluna erp_contratos.sem_contas_receber, então o selo/aviso nunca
-- renderizavam no front (c.sem_contas_receber sempre undefined).
--
-- Aditivo e idempotente:
--  (1) CREATE OR REPLACE VIEW acrescentando sem_contas_receber NO FINAL da lista
--      (única posição permitida pelo CREATE OR REPLACE), preservando
--      security_invoker=true -> RLS por company_id de erp_contratos continua valendo.
--  (2) Registra as chaves de ajuda RD-95 do novo indicador e da nova ação.

CREATE OR REPLACE VIEW public.v_contratos_dashboard
WITH (security_invoker = true) AS
 SELECT id,
    company_id,
    numero,
    nome,
    cliente_id,
    cliente_nome,
    cliente_cnpj,
    tipo,
    descricao,
    escopo,
    valor_mensal,
    valor_atual,
    periodicidade,
    data_inicio,
    data_fim,
    dia_vencimento,
    status,
    forma_pagamento,
    tipo_reajuste,
    reajuste_percentual,
    proximo_reajuste_em,
    ultimo_reajuste_em,
    ultimo_titulo_gerado_em,
    total_titulos_gerados,
    total_faturado,
    responsavel,
    created_at,
        CASE
            WHEN data_fim IS NULL THEN 'indeterminado'::text
            WHEN data_fim < CURRENT_DATE THEN 'vencido'::text
            WHEN data_fim < (CURRENT_DATE + '60 days'::interval) THEN 'renovacao_proxima'::text
            ELSE 'em_dia'::text
        END AS situacao_vigencia,
        CASE
            WHEN proximo_reajuste_em IS NULL THEN 'sem_reajuste_programado'::text
            WHEN proximo_reajuste_em <= CURRENT_DATE THEN 'reajuste_pendente'::text
            WHEN proximo_reajuste_em <= (CURRENT_DATE + '30 days'::interval) THEN 'reajuste_proximo'::text
            ELSE 'em_dia'::text
        END AS situacao_reajuste,
        CASE periodicidade
            WHEN 'mensal'::text THEN COALESCE(valor_atual, valor_mensal)
            WHEN 'bimestral'::text THEN COALESCE(valor_atual, valor_mensal) / 2::numeric
            WHEN 'trimestral'::text THEN COALESCE(valor_atual, valor_mensal) / 3::numeric
            WHEN 'semestral'::text THEN COALESCE(valor_atual, valor_mensal) / 6::numeric
            WHEN 'anual'::text THEN COALESCE(valor_atual, valor_mensal) / 12::numeric
            ELSE COALESCE(valor_atual, valor_mensal)
        END AS mrr_equivalente,
    ( SELECT count(*) AS count
           FROM erp_receber r
          WHERE r.ref_externa_sistema = 'contrato_recorrente'::text AND r.ref_externa_id ~~ (('contrato:'::text || c.id::text) || ':%'::text) AND r.status::text = 'aberto'::text) AS faturas_em_aberto,
    ( SELECT count(*) AS count
           FROM erp_receber r
          WHERE r.ref_externa_sistema = 'contrato_recorrente'::text AND r.ref_externa_id ~~ (('contrato:'::text || c.id::text) || ':%'::text) AND r.status::text = 'aberto'::text AND r.data_vencimento < CURRENT_DATE) AS faturas_vencidas,
    ( SELECT COALESCE(sum(r.valor_pago), 0::numeric) AS "coalesce"
           FROM erp_receber r
          WHERE r.ref_externa_sistema = 'contrato_recorrente'::text AND r.ref_externa_id ~~ (('contrato:'::text || c.id::text) || ':%'::text) AND r.status::text = 'pago'::text) AS total_recebido,
        CASE
            WHEN status::text = 'ativo'::text AND COALESCE(dia_vencimento, 10) >= EXTRACT(day FROM CURRENT_DATE)::integer THEN date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date + (COALESCE(dia_vencimento, 10) - 1)::double precision * '1 day'::interval
            WHEN status::text = 'ativo'::text THEN (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) + '1 mon'::interval)::date + (COALESCE(dia_vencimento, 10) - 1)::double precision * '1 day'::interval
            ELSE NULL::timestamp without time zone
        END AS proxima_fatura_prevista,
    COALESCE(c.sem_contas_receber, false) AS sem_contas_receber
   FROM erp_contratos c;

-- RD-95 "?" do novo indicador e da nova ação (idempotente)
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ge.contrato.sem_contas_receber', '/dashboard/contratos', 'Contratos',
   'Sem contas a receber',
   'Nada a preencher: é um selo automático. Aparece quando o contrato foi ATIVADO sem gerar as parcelas/contas a receber no financeiro.',
   'Avisa que o contrato está ativo mas não tem títulos lançados — para você não esquecer de cobrar. Use quando a cobrança é por fora, permuta ou lançamento manual.',
   'Contrato ativado com o interruptor "Gerar contas a receber" desligado mostra o selo ⚠ Sem contas a receber.',
   'Achar que o contrato não vale porque não tem títulos: ele está ativo; o selo só indica que a cobrança não foi lançada aqui.',
   'gestao_empresarial', 21, 1, 'publicado'),
  ('ge.contrato.gerar_contas_agora', '/dashboard/contratos', 'Contratos',
   'Gerar agora',
   'Nada a preencher: é um botão. Clique para lançar de uma vez as parcelas/contas a receber de todo o período do contrato.',
   'Cria as contas a receber do contrato sem precisar reativar. É idempotente: se algumas parcelas já existirem, não duplica — completa só o que falta.',
   'Clicar em "Gerar agora" num contrato com o selo ⚠ Sem contas a receber lança os títulos e o selo some.',
   'Clicar várias vezes achando que não funcionou: a ação não duplica títulos; rode uma vez e confira a lista de contas a receber.',
   'gestao_empresarial', 22, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
