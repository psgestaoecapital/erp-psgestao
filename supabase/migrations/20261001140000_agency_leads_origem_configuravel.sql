-- Chamado #552 (Pdois · Mauricio, 30/09): "Erro ao gravar um novo lead — não permite avançar". DEFEITO, provado no log:
-- 30/09 11:06, 11:48 e 11:49 (UTC) o fn_agency_lead_criar da Pdois voltou 400 com
--   new row for relation "agency_leads" violates check constraint "agency_leads_origem_check".
-- Causa: a origem do lead virou configurável por empresa em 21/08 (20260821190000 · agency_lead_origem, com WhatsApp,
-- Site, Ligação, E-mail, Evento…), mas o CHECK antigo de agency_leads.origem continuou aceitando só os 4 slugs de antes
-- (prospeccao_ia_fria, indicacao, trafego_pago, relacionamento). Escolher qualquer origem nova na tela = erro ao gravar.
-- Correção: sai o CHECK fixo; entra a mesma regra que já vale para a etapa (fn_agency_leads_valida_etapa): se a
-- empresa tem origens configuradas, a origem do lead tem de ser uma delas; empresa sem origens configuradas segue
-- aceitando os 4 slugs de antes. Nenhum lead existente é alterado (os 70 da Pdois usam slugs que continuam válidos).

ALTER TABLE public.agency_leads DROP CONSTRAINT IF EXISTS agency_leads_origem_check;

CREATE OR REPLACE FUNCTION public.fn_agency_leads_valida_origem()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.origem IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM agency_lead_origem WHERE company_id = NEW.company_id) THEN
    IF NOT EXISTS (SELECT 1 FROM agency_lead_origem WHERE company_id = NEW.company_id AND chave = NEW.origem) THEN
      RAISE EXCEPTION 'origem "%" invalida para os leads desta empresa', NEW.origem
        USING ERRCODE = '23514', HINT = 'use uma origem configurada (agency_lead_origem)';
    END IF;
  ELSIF NEW.origem NOT IN ('prospeccao_ia_fria','indicacao','trafego_pago','relacionamento') THEN
    RAISE EXCEPTION 'origem "%" invalida (empresa sem origens configuradas)', NEW.origem
      USING ERRCODE = '23514', HINT = 'configure as origens do lead da empresa';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_agency_leads_valida_origem ON public.agency_leads;
CREATE TRIGGER trg_agency_leads_valida_origem BEFORE INSERT OR UPDATE OF origem ON public.agency_leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_agency_leads_valida_origem();
