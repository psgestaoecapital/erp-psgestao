-- Chamado #38 · retorno da auditoria RD-70 ao #1595: o backfill estava INCOMPLETO.
-- #1595 consertou o caminho NOVO (aplicar_match escreve baixa+vínculo atômico), mas o varredor de órfãos
-- só materializou vínculo para movimentos com lancamento_tabela IN ('erp_receber','erp_pagar') e
-- lancamento_id NOT NULL. Sobraram 32 movimentos 'conciliado' SEM conciliacao_vinculo (relatado: 0).
--
-- DIAGNÓSTICO NO DADO (RD-38), os 32:
--   • 13 com link direto → TODOS lancamento_tabela='erp_transferencia', match_origem='transferencia'
--     (aplic./resgate de investimento, depósito de cheque, saque, PIX mesma titularidade). NÃO são título.
--     conciliacao_vinculo tem CHECK (lancamento_tabela IN ('erp_pagar','erp_receber')) → uma transferência
--     JAMAIS pode entrar na tabela de vínculo. Logo esses 13 são LEGÍTIMOS conciliado-sem-vínculo-de-título:
--     o modelo é  conciliado ⟹ (vínculo de título) OU (link direto de transferência válido).
--     A auditoria "conciliado sem conciliacao_vinculo" superestimava porque nunca consegue enxergar uma
--     transferência. Nada a corrigir no dado desses 13 — só a DEFINIÇÃO de órfão (abaixo).
--   • 19 sem link → match_origem='agrupado', lancamento_id NULL, e NENHUM título aponta de volta
--     (erp_receber/erp_pagar.movimento_banco_id). São linhas de banco que um fechamento de lote carimbou
--     'conciliado' sem nunca vincular um título (título não cadastrado no sistema). Classificação:
--     9 recebimento_sem_titulo (R$44.289,00) · 7 pagamento_sem_titulo (R$15.574,84) · 3 pix_sem_titulo (R$9.647,08).
--     fn_conciliacao_fechar_agrupado EXIGE vínculo (v_soma=0 → 'nenhuma conta vinculada'); então o modelo
--     NÃO aceita esses como corretos. Não dá para materializar vínculo sem inventar um título (corromperia
--     o dado, RD-30/RD-38). Tratamento: rótulo honesto p/ o operador revisar/cadastrar o título faltante.
--
-- Não há NENHUM movimento conciliado com link direto para erp_receber/erp_pagar sem vínculo (o caso que o
-- #1595 deveria ter pego): todos os 32 eram transferência (13) ou agrupado-sem-título (19). Provado no dado.

-- ── (1) Rótulo honesto nos 19 órfãos reais (idempotente; NÃO toca valor/status financeiro) ────────────
UPDATE public.conciliacao_movimento m
   SET motivo_status = 'agrupado_sem_vinculo:revisar_titulo_nao_cadastrado', updated_at = now()
 WHERE m.status = 'conciliado'
   AND (m.lancamento_tabela IS NULL OR m.lancamento_id IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.movimento_id = m.id)
   AND coalesce(m.motivo_status, '') NOT LIKE 'agrupado_sem_vinculo%';

-- ── (2) Detector de órfãos HONESTO e repetível (p/ a auditoria RD-70) ────────────────────────────────
-- Órfão REAL = conciliado, sem vínculo de título, E sem link direto de transferência válido. Assim a
-- transferência (que nunca entra em conciliacao_vinculo) deixa de contar como órfão.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_orfaos(p_company uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH orf AS (
    SELECT m.* FROM conciliacao_movimento m
    WHERE m.status = 'conciliado'
      AND (p_company IS NULL OR m.company_id = p_company)
      AND NOT EXISTS (SELECT 1 FROM conciliacao_vinculo v WHERE v.movimento_id = m.id)
      AND NOT (m.lancamento_tabela = 'erp_transferencia' AND m.lancamento_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM erp_transferencia t WHERE t.id = m.lancamento_id))
  )
  SELECT jsonb_build_object(
    'ok', true,
    'orfaos_reais', (SELECT count(*) FROM orf),
    'por_categoria', (SELECT coalesce(jsonb_object_agg(cat, n), '{}'::jsonb) FROM (
        SELECT CASE WHEN descricao ILIKE 'PIX%' THEN 'pix_sem_titulo'
                    WHEN natureza = 'credito' THEN 'recebimento_sem_titulo'
                    ELSE 'pagamento_sem_titulo' END AS cat, count(*) n
        FROM orf GROUP BY 1) q),
    'itens', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'empresa', coalesce(c.nome_fantasia, c.razao_social),
        'data', o.data_transacao, 'valor', o.valor, 'natureza', o.natureza,
        'descricao', left(o.descricao, 60), 'motivo', o.motivo_status) ORDER BY o.data_transacao), '[]'::jsonb)
      FROM orf o LEFT JOIN companies c ON c.id = o.company_id)
  );
$$;

COMMENT ON FUNCTION public.fn_conciliacao_orfaos(uuid) IS
  'Chamado #38: órfãos REAIS de conciliação (conciliado sem vínculo de título e sem link direto de transferência). Exclui transferências, que por CHECK nunca entram em conciliacao_vinculo.';

REVOKE ALL ON FUNCTION public.fn_conciliacao_orfaos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_orfaos(uuid) TO authenticated, service_role;
