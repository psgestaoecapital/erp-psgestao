-- PDCA GE · /dashboard/financeiro/conciliacao/inbox · auditor_pdca_2 17/11 (tarefa 2f1a465c, item 1)
--
-- PROBLEMA (RD-38, provado no banco de produção):
--   Movimentos com status='conciliado' cujo título vinculado foi soft-deletado (erp_pagar/
--   erp_receber.deleted_at IS NOT NULL) ficam ÓRFÃOS. A fn_conciliacao_conciliados os ESCONDE
--   de propósito (#71/#38: não vazar dado velho), mas o contador armazenado
--   conciliacao_lote.total_conciliados AINDA os conta. Resultado: a barra de progresso diz
--   "N de N resolvidos · extrato fechado" enquanto a LISTA de conciliados mostra menos (ou zero),
--   e esses movimentos ficam INVISÍVEIS, sem como desvinculá-los pela UI.
--   Lotes reais afetados (não só e2e): "extrato cresol" (10 contados/3 órfãos),
--   SICOOB 01/09-08/09 (14/2), "extrato (60).ofx" (6/1), além dos lotes de aceitação (3/3).
--
-- SOLUÇÃO (aditiva, sem tocar a fn_conciliacao_conciliados existente — evita regressão #71/#38):
--   nova função read-only que LISTA os órfãos de uma empresa, para a UI (1) deixar de mentir
--   "extrato fechado" e (2) oferecer "Desvincular" (via fn_conciliacao_desvincular_movimento,
--   que já existe) para o usuário reabrir o movimento.
--
-- Segurança: LANGUAGE sql STABLE, NÃO SECURITY DEFINER (espelha fn_conciliacao_conciliados) —
--   roda como o usuário e a RLS de conciliacao_movimento/_lote isola por empresa. Filtra ainda
--   por p_company_id. REVOKE anon; EXECUTE só para authenticated/service_role. Não altera dado.

CREATE OR REPLACE FUNCTION public.fn_conciliacao_conciliados_orfaos(
  p_company_id uuid,
  p_limite integer DEFAULT 200
)
RETURNS TABLE(
  movimento_id uuid,
  lote_id uuid,
  lote_nome text,
  data_transacao date,
  valor numeric,
  descricao text,
  natureza text,
  lancamento_tabela text,
  lancamento_id uuid,
  conciliado_em timestamp with time zone
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT m.id, m.lote_id, cl.nome, m.data_transacao, m.valor, m.descricao, m.natureza,
         m.lancamento_tabela, m.lancamento_id, m.match_aplicado_em
  FROM conciliacao_movimento m
  JOIN conciliacao_lote cl ON cl.id = m.lote_id
  WHERE m.company_id = p_company_id
    AND m.status = 'conciliado'
    AND (
      (m.lancamento_tabela = 'erp_pagar'
        AND EXISTS (SELECT 1 FROM erp_pagar p   WHERE p.id = m.lancamento_id AND p.deleted_at IS NOT NULL))
      OR
      (m.lancamento_tabela = 'erp_receber'
        AND EXISTS (SELECT 1 FROM erp_receber r WHERE r.id = m.lancamento_id AND r.deleted_at IS NOT NULL))
    )
  ORDER BY m.match_aplicado_em DESC NULLS LAST
  LIMIT p_limite;
$function$;

REVOKE ALL ON FUNCTION public.fn_conciliacao_conciliados_orfaos(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_conciliados_orfaos(uuid, integer) TO authenticated, service_role;

-- RD-95: "?" do bloco "título excluído" na tela de conciliação.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'financeiro.conciliacao.titulo_excluido',
  '/dashboard/financeiro/conciliacao/inbox',
  'Conciliação',
  'Conciliado com título excluído',
  'Nada a preencher: é um aviso. Lista os movimentos do extrato que foram conciliados a um título (conta a pagar ou receber) que depois foi excluído do sistema.',
  'Esses movimentos não têm mais título por trás, então não contam como resolvidos e a barra de fechamento não os considera "fechados". Use "Desvincular" para o movimento voltar às Pendências e você reconciliá-lo com o título certo.',
  'Um pagamento conciliado a um boleto que foi excluído depois: aparece aqui para você desvincular e vincular ao boleto correto.',
  'Ignorar o aviso achando que o extrato está fechado: enquanto houver movimento aqui, o fechamento real ainda tem pendência.',
  'financeiro',
  34,
  'publicado'
)
ON CONFLICT (chave) DO NOTHING;
