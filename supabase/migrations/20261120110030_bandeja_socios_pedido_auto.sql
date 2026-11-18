-- CEO 18/11 (Rodrigo + Jordana): a tela "Aprovações dos sócios" mostra "nada pendente" apesar de haver itens.
-- Causa (provada no dado, RD-38): fn_pr_bandeja_listar só põe em APROVÁVEL (ramo 'nucleo', com botão de OK) as
-- mensagens requer_ok_ceo=true que têm PEDIDO registrado (ok_ceo_pedido_em OR pedido_ok_socio não-nulos). As 19
-- mensagens vivas requer_ok_ceo=true estavam com os dois NULL (o Code nunca registrava o pedido) → caíam no ramo
-- 'em_andamento' (só informativo, sem botão) e sumiam → "nada pendente". Rodrigo/Jordana (e o CEO) travados há meses.
--
-- Correção (não aprova nada — só torna VISÍVEL/clicável; ok_ceo_em continua exclusivo do clique do sócio/CEO):
--   Parte A1 (going-forward): trigger BEFORE INSERT/UPDATE em erp_agente_mensagem — mensagem que exige OK e ainda
--     não tem pedido nasce/atualiza com ok_ceo_pedido_em=now(). Cobre TODO caminho (envio, revisor que escala, etc.).
--   Parte A2 (backfill idempotente): os requer_ok_ceo=true vivos sem pedido ganham ok_ceo_pedido_em=now() → aprováveis.
--
-- Provado RD-38 (BEGIN..ROLLBACK): bandeja como Rodrigo → nucleo 0→19 (em_andamento→0); trigger seta o pedido numa
-- msg requer_ok_ceo=true sem pedido. O ramo 'em_andamento' de fn_pr_bandeja_listar fica intacto (RD-25 par do #5458:
-- com o RD-103 o revisor LIBERA a maioria dos 19 → saem da lista; sobram as decisões reais, essas aprováveis).
-- SENSÍVEL (fluxo de aprovação) → MERGE AUTORIZADO.

CREATE OR REPLACE FUNCTION public.fn__agente_mensagem_pedido_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Exige OK e ainda não tem pedido → registra o pedido (aparece aprovável na bandeja dos sócios).
  -- NÃO toca ok_ceo_em (o OK real vem só do clique do sócio/CEO). Idempotente (só quando o pedido está NULL).
  IF NEW.requer_ok_ceo AND NEW.ok_ceo_em IS NULL
     AND NEW.ok_ceo_pedido_em IS NULL AND NEW.pedido_ok_socio IS NULL
     AND NOT coalesce(NEW.arquivada, false) AND NEW.status NOT IN ('concluida','recusada') THEN
    NEW.ok_ceo_pedido_em := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- Função de gatilho não é chamável por RPC; fecha a anon/PUBLIC por higiene.
REVOKE ALL ON FUNCTION public.fn__agente_mensagem_pedido_auto() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_agente_mensagem_pedido_auto ON public.erp_agente_mensagem;
CREATE TRIGGER trg_agente_mensagem_pedido_auto
  BEFORE INSERT OR UPDATE ON public.erp_agente_mensagem
  FOR EACH ROW EXECUTE FUNCTION public.fn__agente_mensagem_pedido_auto();

-- Backfill (Parte A2): os requer_ok_ceo=true vivos sem pedido passam a aparecer aprováveis AGORA. Idempotente
-- (só mexe em quem está sem pedido). Nas vagas de teste não existe nenhum desses → casa 0 linhas (no-op).
UPDATE public.erp_agente_mensagem SET ok_ceo_pedido_em = now()
WHERE requer_ok_ceo AND ok_ceo_em IS NULL AND NOT coalesce(arquivada, false)
  AND status NOT IN ('concluida','recusada')
  AND ok_ceo_pedido_em IS NULL AND pedido_ok_socio IS NULL;
