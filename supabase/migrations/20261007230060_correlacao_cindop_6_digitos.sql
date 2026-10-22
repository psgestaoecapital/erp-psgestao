-- Chamado #1944 (Jordana · Pdois, NFS-e com o grupo IBS/CBS) · cIndOp da correlação LC116×NBS saiu como número decimal.
--
-- CAUSA (provada no dado, RD-38): a carga 20260820250000 importou o JSON com cindop como float — "100301.0" e, quando o
-- código começa com zero, "20201.0" (o zero da frente sumiu; o certo é "020201"). Em produção: 895 linhas, 202 com 6
-- dígitos, 153 nesse formato quebrado, 540 nulas. O cadastro do serviço preenche o cIndOp sozinho a partir do NBS
-- (fn_reforma_correlacao_servico) com esse valor; na emissão, reformaIbsCbsDoServico exige 6 dígitos (E0901) e, sem
-- eles, a nota sai SEM o grupo IBS/CBS (só com aviso). Ex.: NBS 1.1406.11.00 (campanhas publicitárias, Pdois) → "100301.0".
--
-- CORREÇÃO (catálogo global de referência, sem dado de cliente): tira o ".0" e devolve o zero da frente (6 dígitos),
-- e uma CHECK impede nova carga no formato errado. Serviços já gravados com o valor quebrado (2, fora da carteira da
-- Jordana) não são tocados aqui.

UPDATE public.fiscal_correlacao_servico
   SET cindop = lpad(split_part(cindop, '.', 1), 6, '0')
 WHERE cindop ~ '^\d{4,6}\.0+$';

ALTER TABLE public.fiscal_correlacao_servico
  DROP CONSTRAINT IF EXISTS fiscal_correlacao_servico_cindop_6dig;
ALTER TABLE public.fiscal_correlacao_servico
  ADD CONSTRAINT fiscal_correlacao_servico_cindop_6dig CHECK (cindop IS NULL OR cindop ~ '^\d{6}$');

DO $$
DECLARE v_ruins int; v_pdois text;
BEGIN
  SELECT count(*) INTO v_ruins FROM public.fiscal_correlacao_servico WHERE cindop IS NOT NULL AND cindop !~ '^\d{6}$';
  IF v_ruins > 0 THEN
    RAISE EXCEPTION '#1944: % linha(s) da correlação seguem com cIndOp fora de 6 dígitos', v_ruins;
  END IF;
  SELECT cindop INTO v_pdois FROM public.fiscal_correlacao_servico WHERE nbs = '1.1406.11.00' AND lc116 = '17.06';
  IF v_pdois IS NOT NULL AND v_pdois <> '100301' THEN
    RAISE EXCEPTION '#1944: NBS 1.1406.11.00 deveria dar cIndOp 100301, deu %', v_pdois;
  END IF;
END $$;
