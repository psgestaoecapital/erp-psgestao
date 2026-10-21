-- Correção dos casos antigos do chamado #3961 (jordana-code · Prigol, Troian e Gean; PS Gestão FORA)
--
-- A regra nova (PR #2955) faz o título conciliado ficar na conta do extrato daqui para frente. Esta migration corrige
-- o que já estava conciliado antes dela, só nas 3 empresas aprovadas pela Jordana (mensagem 740eeb50, grupo C).
--
-- Grupos (classificação de 21/10, conciliacao_movimento.status = 'conciliado', movimento mais recente do título):
--   A) extrato importado na conta errada (ex.: lote "arquivo.ofx16-10.ofx" da Proplay na Prigol, #2914): NÃO corrige.
--      Hoje 0 títulos conciliados nesse caso.
--   B) só o nome difere e a conta é a mesma (receber com conta_bancaria_id já = conta do lote; pagar com nome parecido
--      com o da conta do lote): NÃO corrige (o saldo já está certo). Hoje: Prigol 1 receber (R$ 500,00), Gean 2 receber
--      (R$ 1.378,00).
--   C) diferença real: título sem conta, em conta interna (CAIXA, CARTEIRA, Permuta) ou em outra conta, e o dinheiro
--      veio do extrato de outra conta. CORRIGE: título passa para a conta do lote do extrato.
--      Hoje: Prigol 1 pagar (R$ 0,90); Gean 43 pagar (R$ 26.666,02) + 26 receber (R$ 19.359,04);
--            Troian 75 pagar (R$ 94.212,62) + 90 receber (R$ 49.030,75).
--   Título com baixa ativa ligada a movimento de OUTRA conta = dúvida: fica fora (hoje 0).
--
-- Só muda a conta do título (erp_receber.conta_bancaria_id/conta_bancaria; erp_pagar.conta_bancaria): valor, datas,
-- status e baixas ficam como estão. Antes de mudar, o estado anterior de cada título e das suas baixas vai para
-- public.erp_conciliacao_conta_bkp_3961; cada título ganha a linha CONTA_PELA_CONCILIACAO no histórico.
-- Também: o título 754d58c6 da Prigol (R$ 25.000, PIX no extrato do Sicredi) tinha origem_baixa 'permuta' — passa a
-- 'conciliacao' (só aparece no histórico, nenhum saldo ou relatório lê esse campo). Idempotente: rodar de novo não
-- acha mais nenhum caso C.

CREATE TABLE IF NOT EXISTS public.erp_conciliacao_conta_bkp_3961 (
  id          bigserial PRIMARY KEY,
  tabela      text        NOT NULL,
  titulo_id   uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  titulo      jsonb       NOT NULL,
  baixas      jsonb,
  conta_nova_id   uuid,
  conta_nova_nome text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_conciliacao_conta_bkp_3961 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_conciliacao_conta_bkp_3961 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.erp_conciliacao_conta_bkp_3961_id_seq FROM PUBLIC, anon, authenticated;

CREATE TEMP TABLE _c3961 AS
WITH emp(cid) AS (VALUES ('36b69d77-b4ea-414b-8519-2ff6621c8de7'::uuid),   -- Pdois/Prigol
                         ('d577602d-b21a-4d97-ae59-401777383c23'::uuid),   -- Troian
                         ('a462e13f-0f51-4c54-abe8-4474b591633b'::uuid)),  -- Gean
par AS (
  SELECT m.company_id, m.id mov, m.lote_id, m.data_transacao, m.match_aplicado_em,
         m.lancamento_tabela tab, m.lancamento_id lid
    FROM public.conciliacao_movimento m JOIN emp ON emp.cid = m.company_id
   WHERE m.status = 'conciliado' AND m.lancamento_id IS NOT NULL AND m.lancamento_tabela IN ('erp_receber','erp_pagar')
  UNION
  SELECT m.company_id, m.id, m.lote_id, m.data_transacao, m.match_aplicado_em, v.lancamento_tabela, v.lancamento_id
    FROM public.conciliacao_movimento m JOIN emp ON emp.cid = m.company_id
    JOIN public.conciliacao_vinculo v ON v.movimento_id = m.id
   WHERE m.status = 'conciliado' AND v.lancamento_tabela IN ('erp_receber','erp_pagar')),
ult AS (  -- movimento conciliado mais recente do título, de lote com conta bancária da mesma empresa
  SELECT DISTINCT ON (p.tab, p.lid) p.*, l.conta_bancaria_id conta_lote, bc.nome nome_lote,
         coalesce(l.arquivo_nome, l.nome) lote_arq
    FROM par p JOIN public.conciliacao_lote l ON l.id = p.lote_id
    JOIN public.erp_banco_contas bc ON bc.id = l.conta_bancaria_id AND bc.company_id = p.company_id
   ORDER BY p.tab, p.lid, p.data_transacao DESC, p.match_aplicado_em DESC NULLS LAST, p.mov DESC),
tit AS (
  SELECT u.*, r.conta_bancaria_id tid, r.conta_bancaria tnome
    FROM ult u JOIN public.erp_receber r ON r.id = u.lid AND u.tab = 'erp_receber' AND r.deleted_at IS NULL
  UNION ALL
  SELECT u.*, NULL::uuid, p.conta_bancaria
    FROM ult u JOIN public.erp_pagar p ON p.id = u.lid AND u.tab = 'erp_pagar' AND p.deleted_at IS NULL),
cls AS (
  SELECT t.*, lower(btrim(coalesce(t.tnome, ''))) tn, lower(btrim(t.nome_lote)) ln,
    (SELECT bc.id FROM public.erp_banco_contas bc
      WHERE bc.company_id = t.company_id AND lower(btrim(bc.nome)) = lower(btrim(coalesce(t.tnome, ''))) LIMIT 1) conta_pelo_nome,
    EXISTS (SELECT 1 FROM public.erp_receber_baixa b
              JOIN public.conciliacao_movimento m ON m.id = b.movimento_banco_id
              JOIN public.conciliacao_lote l ON l.id = m.lote_id
             WHERE t.tab = 'erp_receber' AND b.receber_id = t.lid AND b.deleted_at IS NULL
               AND l.conta_bancaria_id IS NOT NULL AND l.conta_bancaria_id <> t.conta_lote)
 OR EXISTS (SELECT 1 FROM public.erp_pagar_baixa b
              JOIN public.conciliacao_movimento m ON m.id = b.movimento_banco_id
              JOIN public.conciliacao_lote l ON l.id = m.lote_id
             WHERE t.tab = 'erp_pagar' AND b.pagar_id = t.lid AND b.deleted_at IS NULL
               AND l.conta_bancaria_id IS NOT NULL AND l.conta_bancaria_id <> t.conta_lote) baixa_outro_extrato
  FROM tit t)
SELECT c.tab, c.lid, c.company_id, c.conta_lote, c.nome_lote, c.tnome
  FROM cls c
 WHERE NOT (c.lote_arq ILIKE 'arquivo.ofx16-10%' AND c.company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7')  -- grupo A
   AND NOT c.baixa_outro_extrato                                                                             -- dúvida
   AND CASE
         WHEN c.tab = 'erp_receber' THEN c.tid IS DISTINCT FROM c.conta_lote                -- C (id é o que o saldo lê)
         WHEN c.tn = c.ln THEN false                                                         -- já certo
         WHEN c.tn = '' THEN true                                                            -- C: sem conta
         WHEN c.conta_pelo_nome IS NOT NULL AND c.conta_pelo_nome <> c.conta_lote THEN true  -- C: outra conta
         ELSE false                                                                          -- B ou dúvida: só lista
       END;

INSERT INTO public.erp_conciliacao_conta_bkp_3961 (tabela, titulo_id, company_id, titulo, baixas, conta_nova_id, conta_nova_nome)
SELECT c.tab, c.lid, c.company_id,
       CASE WHEN c.tab = 'erp_receber' THEN (SELECT to_jsonb(r) FROM public.erp_receber r WHERE r.id = c.lid)
            ELSE (SELECT to_jsonb(p) FROM public.erp_pagar p WHERE p.id = c.lid) END,
       CASE WHEN c.tab = 'erp_receber' THEN (SELECT jsonb_agg(to_jsonb(b)) FROM public.erp_receber_baixa b WHERE b.receber_id = c.lid)
            ELSE (SELECT jsonb_agg(to_jsonb(b)) FROM public.erp_pagar_baixa b WHERE b.pagar_id = c.lid) END,
       c.conta_lote, c.nome_lote
  FROM _c3961 c;

-- 754d58c6 (Prigol): backup antes de trocar a origem (a conta já foi corrigida à mão pela Jordana em 21/10)
INSERT INTO public.erp_conciliacao_conta_bkp_3961 (tabela, titulo_id, company_id, titulo, baixas)
SELECT 'erp_receber', r.id, r.company_id, to_jsonb(r),
       (SELECT jsonb_agg(to_jsonb(b)) FROM public.erp_receber_baixa b WHERE b.receber_id = r.id)
  FROM public.erp_receber r
 WHERE r.id = '754d58c6-bee2-43b4-955b-6f6aa416c625' AND r.origem_baixa = 'permuta';

UPDATE public.erp_receber t
   SET conta_bancaria_id = c.conta_lote, conta_bancaria = c.nome_lote, updated_at = now()
  FROM _c3961 c
 WHERE c.tab = 'erp_receber' AND t.id = c.lid;

UPDATE public.erp_pagar t
   SET conta_bancaria = c.nome_lote, updated_at = now()
  FROM _c3961 c
 WHERE c.tab = 'erp_pagar' AND t.id = c.lid;

INSERT INTO public.erp_lancamento_log (lancamento_id, tabela_origem, user_email, acao, campos_alterados)
SELECT c.lid, c.tab, NULL, 'CONTA_PELA_CONCILIACAO',
       jsonb_build_object('conta_bancaria', jsonb_build_object('de', c.tnome, 'para', c.nome_lote),
                          'motivo', 'Conta alterada de ' || COALESCE(NULLIF(btrim(c.tnome), ''), 'sem conta')
                                    || ' para ' || c.nome_lote || ' pela conciliação (correção dos casos antigos, chamado #3961)')
  FROM _c3961 c;

UPDATE public.erp_receber_baixa b
   SET origem = 'conciliacao'
 WHERE b.receber_id = '754d58c6-bee2-43b4-955b-6f6aa416c625' AND b.origem = 'permuta'
   AND b.movimento_banco_id = 'afd9ab76-d452-474d-b6e2-52171cf42f8c';

UPDATE public.erp_receber r
   SET origem_baixa = 'conciliacao', updated_at = now()
 WHERE r.id = '754d58c6-bee2-43b4-955b-6f6aa416c625' AND r.origem_baixa = 'permuta';

DROP TABLE _c3961;
