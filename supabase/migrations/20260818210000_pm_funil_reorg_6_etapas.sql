-- P&M · Funil de leads — reorganização para as 6 etapas que o CEO quer (Novo Atendimento → Reunião →
-- Proposta → Negociação → Ganho / Perdido). Junta "Novo" + "Em atendimento" numa só e "Reunião agendada" +
-- "Entendimento" em "Reunião".
--
-- Auditoria (RD-38): a infra do funil configurável JÁ existe (desenho 14/08) — funil_etapa (RLS), as RPCs
-- fn_funil_etapas_listar/_salvar/_excluir, o CHECK de agency_leads.etapa JÁ foi removido, e o Kanban de Leads
-- + o modal "Configurar funil" já leem funil_etapa (não hardcoded). O que faltava é ESTE reajuste de etapas:
-- o seed padrão ainda trazia as 8 antigas. Então aqui: (1) atualizo o seed padrão p/ as 6 novas; (2) migro os
-- leads das etapas fundidas; (3) reformo as linhas de funil_etapa das empresas existentes. Sem frontend novo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Seed padrão (novas empresas) → 6 etapas. Mantém o resto de fn_funil_etapas_listar igual.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_funil_etapas_listar(p_company_id uuid, p_tipo_funil text)
 RETURNS TABLE(id uuid, chave text, rotulo text, ordem integer, cor text, tipo_etapa text, ativo boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RAISE EXCEPTION 'sem_acesso';
  END IF;

  IF p_tipo_funil = 'leads'
     AND NOT EXISTS (SELECT 1 FROM funil_etapa fe WHERE fe.company_id = p_company_id AND fe.tipo_funil = 'leads') THEN
    INSERT INTO funil_etapa (company_id, tipo_funil, chave, rotulo, ordem, cor, tipo_etapa)
    SELECT p_company_id, 'leads', d.chave, d.rotulo, d.ordem, d.cor, d.tipo
    FROM (VALUES
      ('novo_atendimento','Novo Atendimento',10,'#F0E9DE','normal'),
      ('reuniao','Reunião',20,'#FCE9C2','normal'),
      ('proposta','Proposta',30,'#F4B860','normal'),
      ('negociacao','Negociação',40,'#E8A93A','normal'),
      ('ganho','Ganho',50,'#DCEFD7','ganho'),
      ('perdido','Perdido',60,'#F4D6D6','perda')
    ) AS d(chave,rotulo,ordem,cor,tipo)
    ON CONFLICT (company_id, tipo_funil, chave) DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT fe.id, fe.chave, fe.rotulo, fe.ordem, fe.cor, fe.tipo_etapa, fe.ativo
    FROM funil_etapa fe
    WHERE fe.company_id = p_company_id AND fe.tipo_funil = p_tipo_funil AND fe.ativo = true
    ORDER BY fe.ordem, fe.rotulo;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Migra os LEADS das etapas fundidas ANTES de mexer no funil (RD-54: nenhum lead perdido)
--    novo + atendimento           → novo_atendimento
--    reuniao_agendada + entendimento → reuniao
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.agency_leads SET etapa = 'novo_atendimento', atualizado_em = now()
 WHERE etapa IN ('novo','atendimento');
UPDATE public.agency_leads SET etapa = 'reuniao', atualizado_em = now()
 WHERE etapa IN ('reuniao_agendada','entendimento');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Reforma o funil_etapa das empresas existentes (idempotente) — para toda empresa que tem funil 'leads'.
-- ─────────────────────────────────────────────────────────────────────────────
-- 3a) garante as 2 novas etapas fundidas
INSERT INTO public.funil_etapa (company_id, tipo_funil, chave, rotulo, ordem, cor, tipo_etapa)
SELECT DISTINCT fe.company_id, 'leads', v.chave, v.rotulo, v.ordem, v.cor, v.tipo
FROM public.funil_etapa fe
CROSS JOIN (VALUES
  ('novo_atendimento','Novo Atendimento',10,'#F0E9DE','normal'),
  ('reuniao','Reunião',20,'#FCE9C2','normal')
) AS v(chave,rotulo,ordem,cor,tipo)
WHERE fe.tipo_funil = 'leads'
ON CONFLICT (company_id, tipo_funil, chave) DO NOTHING;

-- 3b) reordena as etapas mantidas para a sequência nova
UPDATE public.funil_etapa SET ordem = 30 WHERE tipo_funil='leads' AND chave='proposta';
UPDATE public.funil_etapa SET ordem = 40 WHERE tipo_funil='leads' AND chave='negociacao';
UPDATE public.funil_etapa SET ordem = 50 WHERE tipo_funil='leads' AND chave='ganho';
UPDATE public.funil_etapa SET ordem = 60 WHERE tipo_funil='leads' AND chave='perdido';

-- 3c) remove as etapas depreciadas (os leads já saíram delas no passo 2 → sem leads → seguro)
DELETE FROM public.funil_etapa
 WHERE tipo_funil='leads' AND chave IN ('novo','atendimento','reuniao_agendada','entendimento');
