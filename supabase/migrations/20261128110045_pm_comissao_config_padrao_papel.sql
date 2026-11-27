-- P&M · GO-LIVE da agência piloto (CEO 25/11, item 11): % de comissão PADRÃO por papel,
-- configurável em Configurações › Comissões. Hoje toda comissão PREVISTA nasce com 0% porque a
-- aprovação da proposta não tem um padrão — o front manda 0 (fn_agency_proposta_aprovar tem
-- p_comissao_percentual DEFAULT 0). Esta migration cria só o CADASTRO (tabela + RPCs guardadas) e as
-- chaves de ajuda (RD-95). A FUNÇÃO DE APROVAÇÃO NÃO É TOCADA: o front passa a pré-preencher o campo
-- de % com o padrão do papel "comercial", e o usuário ainda ajusta antes de confirmar. Assim a
-- comissão prevista deixa de nascer zerada sem mudar COMO o dinheiro se move.
--
-- Aditiva e idempotente. RLS por company_id, REVOKE anon (RD-52/segurança).
-- RD-38 (provado na sessão): a tabela agency_comissao_config e as chaves de ajuda
-- pm.config.comissao_default_* NÃO existiam (0 linhas) antes desta migration.

CREATE TABLE IF NOT EXISTS public.agency_comissao_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  papel text NOT NULL,                       -- comercial | gestor
  percentual numeric NOT NULL DEFAULT 0 CHECK (percentual >= 0 AND percentual <= 100),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS agency_comissao_config_uk ON public.agency_comissao_config (company_id, papel);

ALTER TABLE public.agency_comissao_config ENABLE ROW LEVEL SECURITY;
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_comissao_config'::regclass AND polname='agency_comissao_config_rls') THEN
    CREATE POLICY agency_comissao_config_rls ON public.agency_comissao_config
      USING (company_id IN (SELECT get_user_company_ids()))
      WITH CHECK (company_id IN (SELECT get_user_company_ids()));
  END IF;
END
$mig$;
REVOKE ALL ON public.agency_comissao_config FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_comissao_config TO authenticated;

-- Listar: devolve SEMPRE os papéis conhecidos (0% enquanto o gestor não configurar).
CREATE OR REPLACE FUNCTION public.fn_agency_comissao_config_listar(p_company_id uuid)
RETURNS TABLE(papel text, percentual numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  RETURN QUERY
  SELECT d.papel, COALESCE(c.percentual, 0)::numeric
    FROM (VALUES ('comercial', 10), ('gestor', 20)) AS d(papel, ordem)
    LEFT JOIN agency_comissao_config c
      ON c.company_id = p_company_id AND c.papel = d.papel
   ORDER BY d.ordem;
END
$function$;

-- Salvar: upsert por (company_id, papel). Valida papel e faixa 0–100.
CREATE OR REPLACE FUNCTION public.fn_agency_comissao_config_salvar(p_company_id uuid, p_papel text, p_percentual numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pct numeric := COALESCE(p_percentual, 0);
BEGIN
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  IF p_papel NOT IN ('comercial', 'gestor') THEN RAISE EXCEPTION 'papel_invalido'; END IF;
  IF v_pct < 0 OR v_pct > 100 THEN RAISE EXCEPTION 'percentual_invalido'; END IF;
  INSERT INTO agency_comissao_config (company_id, papel, percentual, atualizado_em, atualizado_por)
  VALUES (p_company_id, p_papel, v_pct, now(), auth.uid())
  ON CONFLICT (company_id, papel) DO UPDATE
    SET percentual = EXCLUDED.percentual, atualizado_em = now(), atualizado_por = auth.uid();
  RETURN jsonb_build_object('ok', true, 'papel', p_papel, 'percentual', v_pct);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_agency_comissao_config_listar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_agency_comissao_config_salvar(uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_comissao_config_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agency_comissao_config_salvar(uuid, text, numeric) TO authenticated;

-- RD-95: "?" dos campos novos da aba Comissões.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/pm/configuracoes', 'pm', 'publicado'
FROM (VALUES
 ('pm.config.comissao_default_comercial', '% padrão de comissão', 'Comercial',
  'Percentual de comissão sugerido para o comercial que fechou a proposta. Número de 0 a 100.',
  'Ao aprovar uma proposta, este percentual já vem preenchido no campo de comissão — você ainda pode ajustar antes de confirmar. Antes disso, toda comissão prevista nascia com 0%.',
  '5 — o comercial recebe 5% da base da comissão.',
  'Deixar em 0 sem querer: a comissão prevista continua nascendo zerada.', 10),
 ('pm.config.comissao_default_gestor', '% padrão de comissão', 'Gestor do fee',
  'Percentual de comissão sugerido para o gestor responsável pela conta/fee. Número de 0 a 100.',
  'Fica guardado como padrão da agência para o papel de gestão do fee, pronto para as regras de comissão por papel.',
  '2 — o gestor recebe 2% da base.',
  'Confundir com o percentual do comercial: cada papel tem o seu.', 20)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
