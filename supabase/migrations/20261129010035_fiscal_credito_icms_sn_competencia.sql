-- #11424 · Crédito de ICMS do Simples (LC 123/2006 art. 23) por COMPETÊNCIA (mensal).
-- Reaproveita o padrão de erp_fiscal_aliquota_sn (company_id + competencia + valor). A emissão passa a LER o crédito
-- do MÊS da nota (data de emissão). O OPT-IN da empresa (transferir crédito ao contribuinte) continua em
-- erp_fiscal_provider_config.aliquota_credito_icms_sn > 0; AQUI fica o VALOR por competência.
-- Aditiva e idempotente (RD-52). RLS ligada, leitura por empresa, escrita só pela função (Master), REVOKE anon.
--
-- AJUSTE DA REVISÃO (Eng. Chefe, #6169): empresa que OPTOU nunca cai pra 102 em silêncio quando o mês não está
-- lançado — usa o ÚLTIMO valor conhecido (ou o valor configurado) e dispara ALERTA VISÍVEL (opção a, default), ou
-- BLOQUEIA a emissão se o perfil pedir (opção b: credito_sn_bloqueia_sem_mes). E este deploy SEMEIA a competência
-- corrente com o valor JÁ configurado, para no merge NADA mudar. Decisão fiscal (a×b, números mensais) = Eng. Chefe + Adriana.

CREATE TABLE IF NOT EXISTS public.erp_fiscal_credito_sn (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  credito     numeric NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_fiscal_credito_sn_uq UNIQUE (company_id, competencia)
);

COMMENT ON TABLE public.erp_fiscal_credito_sn IS
  '#11424 · crédito de ICMS do Simples (LC 123 art. 23) por competência (mês). A emissão lê o crédito do mês da nota; mês sem valor usa o último conhecido + alerta (ou bloqueia, se o perfil pedir).';

ALTER TABLE public.erp_fiscal_credito_sn ENABLE ROW LEVEL SECURITY;

-- Leitura por empresa (a tela lê o valor do mês como o próprio usuário). Escrita só pela função SECURITY DEFINER.
DROP POLICY IF EXISTS erp_fiscal_credito_sn_sel ON public.erp_fiscal_credito_sn;
CREATE POLICY erp_fiscal_credito_sn_sel ON public.erp_fiscal_credito_sn
  FOR SELECT TO authenticated
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());

REVOKE ALL ON public.erp_fiscal_credito_sn FROM anon;
GRANT SELECT ON public.erp_fiscal_credito_sn TO authenticated;

-- Grava o crédito de ICMS do Simples de uma competência (mês). Só Master, com guarda de empresa (mesma trava da
-- alíquota chapada). p_credito NULL = apaga o lançamento do mês (deixa o mês sem crédito). 0,01% a 5% (Anexo I/II).
CREATE OR REPLACE FUNCTION public.fn_fiscal_credito_sn_salvar(p_company_id uuid, p_competencia date, p_credito numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_comp date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF p_company_id IS NULL OR p_competencia IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Empresa e competência obrigatórias');
  END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT public.fn_pagar_usuario_master(p_company_id) THEN
    RAISE EXCEPTION 'Somente Master (sócio/gerente com nível Master) altera o crédito de ICMS do Simples' USING ERRCODE = '42501';
  END IF;
  IF p_credito IS NOT NULL AND (p_credito <= 0 OR p_credito > 5) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Crédito de ICMS deve ficar entre 0,01% e 5% (ou vazio para não lançar o mês)');
  END IF;
  v_comp := date_trunc('month', p_competencia)::date;
  IF p_credito IS NULL THEN
    DELETE FROM public.erp_fiscal_credito_sn WHERE company_id = p_company_id AND competencia = v_comp;
    RETURN jsonb_build_object('ok', true, 'competencia', v_comp, 'credito', NULL);
  END IF;
  INSERT INTO public.erp_fiscal_credito_sn (company_id, competencia, credito, created_by)
  VALUES (p_company_id, v_comp, round(p_credito, 2), auth.uid())
  ON CONFLICT (company_id, competencia) DO UPDATE SET credito = EXCLUDED.credito, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'competencia', v_comp, 'credito', round(p_credito, 2));
END $function$;

REVOKE EXECUTE ON FUNCTION public.fn_fiscal_credito_sn_salvar(uuid, date, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_credito_sn_salvar(uuid, date, numeric) TO authenticated, service_role;

-- #11424 (revisão) · opção (b): quando true, a emissão BLOQUEIA se a empresa usa crédito e o mês não está lançado,
-- em vez de usar o último valor conhecido (opção a). Default false = opção (a). Decisão Eng. Chefe + Adriana.
ALTER TABLE public.erp_fiscal_provider_config
  ADD COLUMN IF NOT EXISTS credito_sn_bloqueia_sem_mes boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.erp_fiscal_provider_config.credito_sn_bloqueia_sem_mes IS
  '#11424 · true = BLOQUEIA a emissão (empresa que usa crédito) quando a competência do mês não foi lançada; false (default) = usa o último valor conhecido + alerta visível.';

-- #11424 (revisão, Eng. Chefe) · SEED: preserva o STATUS QUO no merge. Toda empresa que já usa crédito (flat > 0)
-- recebe esse MESMO valor na competência FIXA de 11/2026 (mês da revisão/deploy), para seguir emitindo 101 com o
-- crédito atual — agora por competência. A regra mensal vale a partir de 12/2026. DATA FIXA (nunca copiar para outro
-- mês). NÃO inventa alíquota; usa a já configurada. Idempotente (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_fiscal_credito_sn (company_id, competencia, credito, created_by)
SELECT pc.company_id,
       DATE '2026-11-01' AS competencia,
       round(pc.aliquota_credito_icms_sn, 2) AS credito,
       NULL::uuid
FROM public.erp_fiscal_provider_config pc
WHERE pc.provider = 'focusnfe' AND pc.ativo = true
  AND pc.aliquota_credito_icms_sn IS NOT NULL AND pc.aliquota_credito_icms_sn > 0
ON CONFLICT (company_id, competencia) DO NOTHING;

-- RD-95 · "?" dos campos novos da Configuração Fiscal (crédito de ICMS por competência).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('fiscal.config.credito_icms_sn_competencia','/dashboard/configuracoes/fiscal','Configuração Fiscal','Crédito de ICMS do mês (%)',
   'A alíquota do crédito de ICMS do Simples daquele MÊS (o contador informa, mês a mês). Escolha a competência (mês) e digite o percentual. Deixe vazio e salve para apagar o mês.',
   'A NF-e usa o crédito do MÊS DA EMISSÃO (vCredICMSSN do item). Se o mês não estiver lançado, a nota usa o último valor conhecido e a emissão avisa — lance o mês para manter o crédito correto.',
   'Novembro/2026: 3,80%. Em dezembro o contador lança o valor de dezembro.',
   'Lançar só um mês e achar que vale para sempre: cada mês precisa do seu valor. Sem o mês atual, a emissão avisa e usa o último conhecido.',
   'fiscal', 4, 'publicado'),
  ('fiscal.config.salvar_credito_sn_competencia','/dashboard/configuracoes/fiscal','Configuração Fiscal','Salvar crédito do mês',
   'Grava o crédito de ICMS do mês escolhido. Só o Master (sócio/gerente) altera.',
   'Com o mês lançado, as NF-e daquele mês para contribuinte saem com o crédito (CSOSN 101).',
   'Salvar 3,80% para novembro/2026.',
   'Esquecer de lançar o mês corrente: a emissão avisa (e usa o último valor conhecido) até você lançar.',
   'fiscal', 5, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo,
  o_que_preencher=EXCLUDED.o_que_preencher, para_que_serve=EXCLUDED.para_que_serve,
  exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
