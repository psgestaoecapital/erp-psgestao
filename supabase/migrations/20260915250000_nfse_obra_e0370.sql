-- ============================================================
-- NFS-e · #18 · grupo de OBRA obrigatório para serviços de construção (regra E0370 do emissor nacional)
-- ============================================================
-- Provado no dado (RD-38): a NFS-e da R.R (SRV00001, LC116 07.02, código de tributação 070202) foi
-- REJEITADA com motivo E0370: "O grupo de informações de obra é obrigatório quando o código de
-- tributação nacional pertencer a um dos subitens 07.02.01, 07.02.02, 07.04.01, 07.05.01, 07.05.02,
-- 07.06.01, 07.06.02, 07.07.01, 07.08.01, 07.17.01, 07.19.01, 14.14.03 e 14.14.04. Sempre obrigatório
-- informar o CNO OU o endereço da obra." Não é melhoria: sem obra a nota NÃO passa.
--
-- A estrutura de obra JÁ EXISTE (é ligar, não construir): projetos_obras.cno/codigo_obra_municipal,
-- erp_obra_planta.obra_endereco/cidade/uf, erp_nfse_emitidas.obra_id.
--
-- ⚠️ A lista dos 13 subitens é PARÂMETRO, não código chumbado (outra construtora vai precisar — a
-- FC PISOS também é 07.02/07.05). Guardada em tabela; company_id NULL = regra nacional (vale p/ todos),
-- com espaço para exceção por empresa no futuro.

CREATE TABLE IF NOT EXISTS public.erp_fiscal_servico_obra_obrigatoria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid,                       -- NULL = regra nacional (todos); preenchido = exceção por empresa
  codigo      text NOT NULL,              -- código de tributação normalizado (só dígitos), ex '070202'
  descricao   text,
  base_legal  text DEFAULT 'E0370 · leiaute nacional NFS-e',
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_servico_obra_codigo ON public.erp_fiscal_servico_obra_obrigatoria (COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid), codigo);
ALTER TABLE public.erp_fiscal_servico_obra_obrigatoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS servico_obra_sel ON public.erp_fiscal_servico_obra_obrigatoria;
CREATE POLICY servico_obra_sel ON public.erp_fiscal_servico_obra_obrigatoria FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());

-- seed dos 13 subitens nacionais (regra E0370). ON CONFLICT: idempotente.
INSERT INTO public.erp_fiscal_servico_obra_obrigatoria (company_id, codigo, descricao) VALUES
  (NULL,'070201','Execução de obras de construção civil'),
  (NULL,'070202','Execução de obras de construção civil (mão de obra)'),
  (NULL,'070401','Demolição'),
  (NULL,'070501','Reparação, conservação e reforma de edifícios/estradas/obras'),
  (NULL,'070502','Reparação, conservação e reforma (exceto material do prestador)'),
  (NULL,'070601','Colocação e instalação de tapetes/pisos/revestimentos'),
  (NULL,'070602','Colocação e instalação (exceto material do prestador)'),
  (NULL,'070701','Recuperação, raspagem, polimento e lustração de pisos'),
  (NULL,'070801','Calafetação'),
  (NULL,'071701','Escoramento, contenção de encostas e obras congêneres'),
  (NULL,'071901','Acompanhamento e fiscalização da execução de obras'),
  (NULL,'141403','Recondicionamento de motores (obra)'),
  (NULL,'141404','Recauchutagem/regeneração de pneus (obra)')
ON CONFLICT (COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid), codigo) DO NOTHING;

-- EXIGE OBRA? (normaliza o código; regra nacional OU exceção da empresa). Genérico por company_id.
CREATE OR REPLACE FUNCTION public.fn_fiscal_exige_obra(p_company_id uuid, p_codigo_servico text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.erp_fiscal_servico_obra_obrigatoria
     WHERE ativo AND (company_id IS NULL OR company_id = p_company_id)
       AND codigo = regexp_replace(COALESCE(p_codigo_servico,''),'[^0-9]','','g')
  );
$fn$;
GRANT EXECUTE ON FUNCTION public.fn_fiscal_exige_obra(uuid, text) TO authenticated;

-- PENDÊNCIA DE OBRA na emissão: dado o serviço + a obra vinculada (obra_id) OU CNO/endereço avulsos,
-- diz se falta obra e devolve a mensagem E0370 (trava PROATIVA — bloqueia antes de a prefeitura rejeitar).
CREATE OR REPLACE FUNCTION public.fn_nfse_obra_pendente(p_company_id uuid, p_codigo_servico text, p_obra_id uuid DEFAULT NULL, p_cno text DEFAULT NULL, p_endereco text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_exige boolean; v_tem_cno boolean := false; v_tem_end boolean := false; v_cno_obra text;
BEGIN
  v_exige := public.fn_fiscal_exige_obra(p_company_id, p_codigo_servico);
  IF NOT v_exige THEN RETURN jsonb_build_object('exige_obra', false, 'pendente', false); END IF;
  -- CNO/endereço informados na própria emissão
  v_tem_cno := COALESCE(length(regexp_replace(COALESCE(p_cno,''),'[^0-9]','','g')) > 0, false);
  v_tem_end := COALESCE(length(trim(COALESCE(p_endereco,''))) > 0, false);
  -- ou o CNO da obra vinculada (projetos_obras). O endereço, quando não avulso, vem da tela.
  IF NOT v_tem_cno AND p_obra_id IS NOT NULL THEN
    SELECT COALESCE(o.cno, o.codigo_obra_municipal) INTO v_cno_obra FROM public.projetos_obras o WHERE o.id = p_obra_id LIMIT 1;
    IF v_cno_obra IS NOT NULL AND length(regexp_replace(v_cno_obra,'[^0-9]','','g'))>0 THEN v_tem_cno := true; END IF;
  END IF;
  RETURN jsonb_build_object(
    'exige_obra', true,
    'pendente', NOT (v_tem_cno OR v_tem_end),
    'mensagem', CASE WHEN (v_tem_cno OR v_tem_end) THEN NULL
                     ELSE 'Este serviço é de construção (regra E0370): informe o CNO ou o endereço da obra antes de emitir. Sem um dos dois, a prefeitura rejeita a nota.' END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.fn_nfse_obra_pendente(uuid, text, uuid, text, text) TO authenticated;
