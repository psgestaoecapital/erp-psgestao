-- ONDA 2 do Hub — Da obra ao resultado: fecha o elo MEDIÇÃO -> CONTA A RECEBER.
-- Hoje a aprovação de uma medição de obra NÃO gera título a receber (não há trigger em
-- projetos_obra_medicao). "A obra vira receita" falhava no teste ao vivo.
--
-- Correção: ao APROVAR uma medição (status 'aprovada'), um título a receber é criado
-- automaticamente para o cliente da obra, com o valor da medição e o centro de custo da obra.
-- Segue o modelo de fn_contrato_gerar_receber (INSERT direto em erp_receber, idempotência por
-- ref_externa) — e NÃO fn_receber_criar_com_parcelas_v2, cuja guarda de plano/usuário não cabe
-- em trigger (dispara sem auth do usuário no servidor).
--
-- Regras:
--  - só gera quando status='aprovada', não excluída e valor_total > 0 (rascunho não gera);
--  - IDEMPOTENTE: aprovar 2x não duplica (guarda por ref_externa_sistema='obra_medicao' +
--    ref_externa_id = medição; origem_recebivel_id também aponta para a medição);
--  - ESTORNO: medição excluída (excluido_em) ou que deixa de estar aprovada -> cancela o título
--    gerado (se ainda não pago/parcial/renegociado);
--  - empresa: o título entra na MESMA empresa da obra/medição (RLS por company_id no read).
--
-- Prova RD-38 (ROLLBACK, DEMO "Construtora Modelo", obra DEMO-OB-002 Clínica Bem Viver):
--  1) rascunho -> 0 títulos; 2) aprovar R$ 25.000 -> 1 título com cliente e centro da obra;
--  3) aprovar de novo -> ainda 1 (idempotente); 4) excluir -> título cancelado.

-- ci-sem-guarda: fn_obra_medicao_gerar_receber — trigger interno; grava o receber na MESMA empresa
-- da obra/medição (v_obra.company_id), que a RLS de projetos_obra_medicao já guardou na aprovação.
-- Sem GRANT a usuário (função de trigger, revogada de PUBLIC/anon).
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_gerar_receber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_obra record; v_desc text; v_venc date; v_ref text;
BEGIN
  v_ref := NEW.id::text;

  -- ESTORNO: medição excluída ou deixou de estar aprovada -> cancela o título ainda não pago.
  IF (TG_OP = 'UPDATE') AND (
        (NEW.excluido_em IS NOT NULL AND OLD.excluido_em IS NULL)
     OR (OLD.status = 'aprovada' AND NEW.status IS DISTINCT FROM 'aprovada')
     ) THEN
    UPDATE erp_receber SET status = 'cancelado', cancelado_em = now(), updated_at = now()
     WHERE ref_externa_sistema = 'obra_medicao' AND ref_externa_id = v_ref
       AND deleted_at IS NULL AND status IN ('aberto', 'vencido', 'previsto');
    RETURN NEW;
  END IF;

  -- GERAÇÃO: só quando aprovada, não excluída e com valor.
  IF NOT (NEW.status = 'aprovada' AND NEW.excluido_em IS NULL AND COALESCE(NEW.valor_total, 0) > 0) THEN
    RETURN NEW;
  END IF;
  -- só na transição para aprovada (não re-dispara em updates posteriores da mesma aprovação).
  IF TG_OP = 'UPDATE' AND OLD.status = 'aprovada' AND OLD.aprovada_em IS NOT DISTINCT FROM NEW.aprovada_em THEN
    RETURN NEW;
  END IF;
  -- IDEMPOTENTE: já existe título vivo para esta medição?
  IF EXISTS (SELECT 1 FROM erp_receber
              WHERE ref_externa_sistema = 'obra_medicao' AND ref_externa_id = v_ref
                AND deleted_at IS NULL AND status <> 'cancelado') THEN
    RETURN NEW;
  END IF;

  SELECT id, company_id, cliente_id, cliente_nome, centro_custo_id, numero, nome
    INTO v_obra FROM projetos_obras WHERE id = NEW.obra_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_venc := CURRENT_DATE + 30;  -- vencimento padrão: 30 dias da aprovação
  v_desc := format('Medição %s - Obra %s', COALESCE(NEW.numero::text, '?'), COALESCE(v_obra.nome, v_obra.numero, 'obra'));

  INSERT INTO erp_receber (
    company_id, cliente_id, cliente_nome, descricao, categoria, valor,
    data_emissao, data_vencimento, data_competencia, status, centro_custo_id,
    origem_recebivel_id, ref_externa_id, ref_externa_sistema, observacoes, created_at
  ) VALUES (
    v_obra.company_id, v_obra.cliente_id, v_obra.cliente_nome, v_desc, 'Medição de obra', NEW.valor_total,
    CURRENT_DATE, v_venc, date_trunc('month', v_venc)::date, 'aberto', v_obra.centro_custo_id,
    NEW.id, v_ref, 'obra_medicao',
    format('Gerado automaticamente da medição %s (obra %s) em %s', COALESCE(NEW.numero::text, '?'), COALESCE(v_obra.numero, '?'), now()::date),
    now()
  );
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.fn_obra_medicao_gerar_receber() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_obra_medicao_gerar_receber ON public.projetos_obra_medicao;
CREATE TRIGGER trg_obra_medicao_gerar_receber
  AFTER INSERT OR UPDATE OF status, aprovada_em, excluido_em ON public.projetos_obra_medicao
  FOR EACH ROW EXECUTE FUNCTION public.fn_obra_medicao_gerar_receber();
