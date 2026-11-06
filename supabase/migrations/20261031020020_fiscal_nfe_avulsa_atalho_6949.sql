-- #3861 (complemento, FCR; vale para todas as empresas) · NF-e avulsa: atalho CFOP 6.949 e renome do 5.949.
-- Pedido da Jordana (27/10): o atalho "Garantia" (5.949) passa a se chamar "Outras saídas ou Simples remessa" e
-- ganha o par "fora do estado" (6.949); a busca do campo "CFOP da nota" tem de achar os dois (6.949 entra no catálogo).
-- ADITIVA: só catálogo global (sem dado de cliente): 1 renome de atalho global, 1 atalho novo, 1 CFOP novo, texto do "?".
-- Não toca função, view, policy nem grant.

UPDATE public.erp_fiscal_remessa_tipos
   SET nome = 'Outras saídas ou Simples remessa',
       natureza = 'Outras saídas ou simples remessa'
 WHERE company_id IS NULL AND cfop_dentro = '5949' AND nome = 'Garantia';

INSERT INTO public.erp_fiscal_remessa_tipos (nome, natureza, cfop_dentro, cfop_fora)
SELECT 'Outras saídas ou Simples remessa (fora do estado)', 'Outras saídas ou simples remessa', '6949', '6949'
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_fiscal_remessa_tipos WHERE company_id IS NULL AND cfop_dentro = '6949'
);

INSERT INTO public.erp_fiscal_cfop_saida (cfop, descricao, natureza_sugerida, exige_referenciada)
VALUES ('6949', 'Outra saída de mercadoria ou prestação de serviço não especificado (fora do estado)', 'Outras saídas', false)
ON CONFLICT (cfop) DO NOTHING;

UPDATE public.erp_ajuda_campo
   SET o_que_preencher = 'Escolha um dos atalhos prontos (conserto, retorno de conserto, comodato, demonstração, outras saídas ou simples remessa — dentro ou fora do estado). Ele preenche o CFOP e a natureza.'
 WHERE chave = 'fiscal.nfe_avulsa.atalho';
