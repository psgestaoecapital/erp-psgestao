-- Chamado #1755 (Gean) · continuação: o produto que JÁ EXISTIA ficava sem CEST mesmo com o CEST na nota de compra.
-- A #2123 (20261016190120) passou o CEST da nota para o produto criado pelo botão "Criar produto" do item.
-- Mas na Gean a peça costuma nascer antes, na OS (diagnóstico), e o item da nota só é LIGADO a ela depois
-- (fn_nfe_item_vincular_os herda o produto do diagnóstico; fn_nfe_item_vincular liga à mão; de-para na importação).
-- Prova (16/10, Gean): os 4 produtos criados depois da #2123 nasceram na OS e ficaram sem CEST, com a nota trazendo
-- 0103700/0105400/0107300/0107500; 240 produtos da Gean estão sem CEST e têm nota de compra com um CEST único.
-- Sem CEST a SEFAZ rejeita a venda com ST.
-- Agora: ao ligar um item de NF de entrada a um produto (qualquer caminho), se o produto está SEM CEST e a nota traz
-- um CEST de 7 dígitos, o cadastro recebe esse CEST. Nunca troca um CEST já preenchido; não mexe em origem, NCM,
-- CFOP nem unidade. Os produtos que já estão ligados não são alterados aqui (acerto dos 240 depende da Jordana).

CREATE OR REPLACE FUNCTION public.tg_nfe_item_completa_cest_produto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cest text;
BEGIN
  IF NEW.produto_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.produto_id IS NOT DISTINCT FROM OLD.produto_id THEN RETURN NEW; END IF;
  v_cest := regexp_replace(COALESCE(NEW.cest, ''), '\D', '', 'g');
  IF length(v_cest) <> 7 THEN RETURN NEW; END IF;
  -- só o produto da MESMA empresa do item, e só se ainda não tem CEST
  UPDATE erp_produtos
     SET cest = v_cest, updated_at = now()
   WHERE id = NEW.produto_id AND company_id = NEW.company_id
     AND NULLIF(btrim(COALESCE(cest, '')), '') IS NULL;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_nfe_item_completa_cest_produto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_nfe_item_completa_cest_produto ON public.erp_nfe_recebidas_itens;
CREATE TRIGGER tg_nfe_item_completa_cest_produto
  AFTER INSERT OR UPDATE OF produto_id ON public.erp_nfe_recebidas_itens
  FOR EACH ROW WHEN (NEW.produto_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_nfe_item_completa_cest_produto();
