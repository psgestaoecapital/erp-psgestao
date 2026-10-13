-- Guarda 232 no CADASTRO: cliente declarado "contribuinte" de ICMS exige Inscrição Estadual.
-- Sem IE, a SEFAZ rejeita a NF-e ("IE do destinatário não informada" · 232) e o faturamento trava.
--
-- Defesa em profundidade: o PessoaForm já barra no clique de salvar; este trigger blinda os demais
-- caminhos de escrita (API, importação Omie, edição direta no banco). Dispara SÓ na transição ruim —
-- INSERT novo, virar "contribuinte", ou limpar a IE de um contribuinte — então NÃO trava a edição de
-- um campo alheio nas 10 linhas legadas que hoje já estão contribuinte-sem-IE (essas quem protege é o
-- bloqueio da emissão, no nfe-validator). "isento"/"não contribuinte" (indIEDest 2/9) não exigem IE.
--
-- Não é SECURITY DEFINER (trigger comum, roda no contexto de quem escreve e só levanta erro) → fora do
-- gate check:fn-guards. RD-52 (arquivo = ledger; deploy-migrations aplica no push à main).

CREATE OR REPLACE FUNCTION public.fn_guard_cliente_contribuinte_ie()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.contribuinte_icms = 'contribuinte'
     AND NULLIF(regexp_replace(COALESCE(NEW.ie, ''), '\D', '', 'g'), '') IS NULL
     AND (TG_OP = 'INSERT'
          OR NEW.contribuinte_icms IS DISTINCT FROM OLD.contribuinte_icms
          OR NEW.ie IS DISTINCT FROM OLD.ie) THEN
    RAISE EXCEPTION 'Contribuinte de ICMS exige Inscrição Estadual (IE). Informe a IE do cliente, ou marque como isento / não contribuinte. Sem isso a SEFAZ rejeita a NF-e (232 · IE do destinatário não informada).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_cliente_contribuinte_ie ON public.erp_clientes;
CREATE TRIGGER trg_guard_cliente_contribuinte_ie
  BEFORE INSERT OR UPDATE ON public.erp_clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_cliente_contribuinte_ie();
