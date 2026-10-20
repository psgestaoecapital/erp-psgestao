-- Pedido da Jordana (20/10, Canal PS, msg 8c4a2b9c) — Pdois/Prigol: extrato OFX da Proplay importado por engano.
-- Em 20/10 09h27 (BRT) o arquivo "arquivo.ofx16-10.ofx" foi importado na conta SICREDI PRIGOL da Pdois
-- (company 36b69d77-…, lote 0baaa231-090b-40af-8f0f-0d2b2bf950b7). São 7 movimentos de 16/10 (R$ 1.156,05).
--
-- Prova no dado (RD-38, conferida em produção antes desta PR):
--   * os 7 estão PENDENTES, sem lancamento_id, sem match aplicado, sem conciliacao_vinculo e sem erp_transferencia;
--   * os 7 existem na Proplay (b2b96eef-…) com o MESMO id_externo (FITID) — 7/7 —, mesma data, valor e descrição.
--
-- Correção de dado de UMA empresa, sem tocar título: apaga só esse lote (os movimentos saem por ON DELETE CASCADE).
-- Guarda: se qualquer condição acima deixar de valer (alguém conciliou/vinculou no meio do caminho, ou a duplicata
-- na Proplay não fecha 7/7), NÃO apaga nada e só avisa no log do deploy. Em banco sem o lote (testes) é no-op.
-- Backup completo (lote + movimentos) em rls2_backup antes de apagar.

CREATE SCHEMA IF NOT EXISTS rls2_backup;
REVOKE ALL ON SCHEMA rls2_backup FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS rls2_backup.conciliacao_lote_bkp_pdois_ofx_20261020 AS
SELECT l.*, now() AS snapshot_em FROM public.conciliacao_lote l
 WHERE l.id = '0baaa231-090b-40af-8f0f-0d2b2bf950b7'
   AND l.company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7';

CREATE TABLE IF NOT EXISTS rls2_backup.conciliacao_movimento_bkp_pdois_ofx_20261020 AS
SELECT m.*, now() AS snapshot_em FROM public.conciliacao_movimento m
 WHERE m.lote_id = '0baaa231-090b-40af-8f0f-0d2b2bf950b7'
   AND m.company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7';

DO $$
DECLARE
  c_lote    CONSTANT uuid := '0baaa231-090b-40af-8f0f-0d2b2bf950b7';
  c_pdois   CONSTANT uuid := '36b69d77-b4ea-414b-8519-2ff6621c8de7';
  c_proplay CONSTANT uuid := 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490';
  v_total int; v_livres int; v_dup int; v_depois int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conciliacao_lote WHERE id = c_lote AND company_id = c_pdois) THEN
    RAISE NOTICE '[pdois-ofx] lote % não existe neste banco — nada a fazer', c_lote;
    RETURN;
  END IF;

  SELECT count(*) INTO v_total FROM public.conciliacao_movimento WHERE lote_id = c_lote;

  SELECT count(*) INTO v_livres
    FROM public.conciliacao_movimento m
   WHERE m.lote_id = c_lote
     AND m.company_id = c_pdois
     AND m.status = 'pendente'
     AND m.lancamento_id IS NULL
     AND m.match_aplicado_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.conciliacao_vinculo v WHERE v.movimento_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.erp_transferencia t WHERE t.movimento_id = m.id);

  SELECT count(*) INTO v_dup
    FROM public.conciliacao_movimento m
   WHERE m.lote_id = c_lote
     AND EXISTS (SELECT 1 FROM public.conciliacao_movimento p
                  WHERE p.company_id = c_proplay
                    AND p.id_externo = m.id_externo
                    AND p.data_transacao = m.data_transacao
                    AND p.valor = m.valor
                    AND p.natureza = m.natureza);

  RAISE NOTICE '[pdois-ofx] ANTES: movimentos=% · livres (pendente, sem baixa/vínculo)=% · iguais na Proplay=%',
    v_total, v_livres, v_dup;

  IF v_total <> 7 OR v_livres <> 7 OR v_dup <> 7 THEN
    RAISE NOTICE '[pdois-ofx] guarda: condição mudou (esperado 7/7/7) — NADA foi apagado; revisar à mão';
    RETURN;
  END IF;

  DELETE FROM public.conciliacao_lote WHERE id = c_lote AND company_id = c_pdois;

  SELECT count(*) INTO v_depois FROM public.conciliacao_movimento WHERE lote_id = c_lote;
  RAISE NOTICE '[pdois-ofx] DEPOIS: lote apagado; movimentos restantes do lote=% (esperado 0)', v_depois;
END $$;
