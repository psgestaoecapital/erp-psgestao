-- BLOCO 5: enquadramento ICMS dos clientes com contribuinte_icms NULO. Proposta aprovada pelo CEO.
-- NULO não gera rejeição 232 (o provider deriva o indIEDest de ter IE) — é qualidade de dado, não incêndio.
--
-- Regra híbrida:
--  • PF/F (pessoa física, 2.513): default 'nao_contribuinte' (indIEDest=9). PF raramente é contribuinte
--    de ICMS com IE — o default é seguro e torna o indIEDest explícito.
--  • PJ/J (3.093) e sem-tipo (34): NÃO tocados aqui. Uma PJ pode ser contribuinte, isento ou não
--    contribuinte; chutar erraria o indIEDest. Esses recebem AVISO na tela (edição / 1ª emissão), no app.
--
-- Reversível: espelho em bkp_clientes_enquadramento_20260923 (id + valor antigo). Idempotente
-- (o WHERE só pega quem ainda é NULO). Não dispara o trigger trg_guard_cliente_contribuinte_ie
-- (fira só em contribuinte='contribuinte'). RD-52 (arquivo = ledger; aplica no push à main).

CREATE TABLE IF NOT EXISTS public.bkp_clientes_enquadramento_20260923 AS
SELECT id, contribuinte_icms AS contribuinte_icms_antigo, tipo_pessoa, now() AS espelhado_em
FROM public.erp_clientes
WHERE contribuinte_icms IS NULL AND tipo_pessoa IN ('PF','F');

UPDATE public.erp_clientes
   SET contribuinte_icms = 'nao_contribuinte', updated_at = now()
 WHERE contribuinte_icms IS NULL AND tipo_pessoa IN ('PF','F');
