-- Chamado #2941 (Jordana) · Pdois — "Cliquei no lead para preencher contrato e os dados de um cliente que já
-- está registrado não trouxe os dados cadastrais."
--
-- PROVADO NO DADO (RD-38): o cliente tem DOIS cadastros em erp_clientes com o mesmo nome (UNIMED EXTREMO OESTE):
--   23d94214… — antigo, só com o nome (sem CNPJ, endereço nem e-mail);
--   02dc6d47… — completo (CNPJ 80.653.975/0001-58), da importação de 27/07.
-- O lead 37341817… (agency_leads.erp_cliente_id) e a solicitação de contrato 0ce278d2… (erp_contratos.cliente_id,
-- status 'solicitado', 14/10) estão ligados ao cadastro vazio — por isso o "Solicitar contrato" não trouxe os dados.
-- Nada mais aponta para o cadastro vazio (propostas, agency_contratos, agency_clientes, erp_receber: 0 linhas).
--
-- CORREÇÃO (dado de UMA empresa, nenhum título): religa o lead e a solicitação de contrato ao cadastro completo.
-- Só o vínculo de cliente muda; o que o usuário preencheu na solicitação fica como está. O cadastro vazio não é
-- apagado. Idempotente (só toca o que ainda aponta para o cadastro vazio).
-- Reversível: espelho em bkp_2941_pdois_lead_contrato_20261016 (RLS ligada, sem acesso para anon/authenticated).
-- RD-52 (arquivo = ledger; aplica no push à main).

CREATE TABLE IF NOT EXISTS public.bkp_2941_pdois_lead_contrato_20261016 AS
SELECT 'agency_leads'::text AS tabela, l.id, l.erp_cliente_id AS cliente_id_antigo, now() AS espelhado_em
  FROM public.agency_leads l
 WHERE l.id = '37341817-f108-44fb-bd4e-365ec16a9d4f'
   AND l.company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7'
   AND l.erp_cliente_id = '23d94214-8f6d-44f2-b2c5-29b11891cbbe'
UNION ALL
SELECT 'erp_contratos', c.id, c.cliente_id, now()
  FROM public.erp_contratos c
 WHERE c.id = '0ce278d2-0756-4ed8-acac-9e2868606149'
   AND c.company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7'
   AND c.cliente_id = '23d94214-8f6d-44f2-b2c5-29b11891cbbe';

ALTER TABLE public.bkp_2941_pdois_lead_contrato_20261016 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bkp_2941_pdois_lead_contrato_20261016 FROM PUBLIC, anon, authenticated;

UPDATE public.agency_leads l
   SET erp_cliente_id = c.id
  FROM public.erp_clientes c
 WHERE l.id = '37341817-f108-44fb-bd4e-365ec16a9d4f'
   AND l.company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7'
   AND l.erp_cliente_id = '23d94214-8f6d-44f2-b2c5-29b11891cbbe'
   AND c.id = '02dc6d47-8286-4d06-b90d-9dc4965bb1ed'
   AND c.company_id = l.company_id;

UPDATE public.erp_contratos k
   SET cliente_id = c.id
  FROM public.erp_clientes c
 WHERE k.id = '0ce278d2-0756-4ed8-acac-9e2868606149'
   AND k.company_id = '36b69d77-b4ea-414b-8519-2ff6621c8de7'
   AND k.cliente_id = '23d94214-8f6d-44f2-b2c5-29b11891cbbe'
   AND c.id = '02dc6d47-8286-4d06-b90d-9dc4965bb1ed'
   AND c.company_id = k.company_id;

-- Prova na própria aplicação: se o lead e a solicitação existem (produção), têm que sair daqui ligados ao cadastro
-- completo. Em banco sem essas linhas (testes/local), não há o que conferir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.agency_leads WHERE id = '37341817-f108-44fb-bd4e-365ec16a9d4f')
     AND NOT EXISTS (SELECT 1 FROM public.agency_leads
                      WHERE id = '37341817-f108-44fb-bd4e-365ec16a9d4f'
                        AND erp_cliente_id = '02dc6d47-8286-4d06-b90d-9dc4965bb1ed') THEN
    RAISE EXCEPTION '#2941: lead 37341817 não ficou ligado ao cadastro completo 02dc6d47';
  END IF;
  IF EXISTS (SELECT 1 FROM public.erp_contratos WHERE id = '0ce278d2-0756-4ed8-acac-9e2868606149')
     AND NOT EXISTS (SELECT 1 FROM public.erp_contratos
                      WHERE id = '0ce278d2-0756-4ed8-acac-9e2868606149'
                        AND cliente_id = '02dc6d47-8286-4d06-b90d-9dc4965bb1ed') THEN
    RAISE EXCEPTION '#2941: solicitação de contrato 0ce278d2 não ficou ligada ao cadastro completo 02dc6d47';
  END IF;
END $$;
