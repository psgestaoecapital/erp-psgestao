-- ============================================================
-- LGPD · restaurar o gate de consentimento (P0 conformidade) + versão 1.2
-- ============================================================
-- Contexto (arqueologia provada no git): o gate ATIVOU e PAROU. Cadeia:
--   · 16/04 e40cb27 montou <LgpdConsentModal/> em dashboard/layout.tsx;
--   · 19/04 a11856d ("layout v11.0 premium", +1212/-242) removeu acidentalmente;
--   · 14/05 #124 restaurou (montou no ROOT src/app/layout.tsx);
--   · 14/05 #126 REVERTEU o #124 (47s, sem justificativa) → é o que deixa o gate fora HOJE.
--     14/05 = a data do último aceite registrado. Bate exato.
-- A construção do backend já existia (RD-26): lgpd_consentimentos (consolidado),
-- lgpd_consentimentos_granulares (granular via fn_lgpd_registrar_consentimento, com IP+UA),
-- 8 finalidades, /termos, /privacidade, meus-dados. Faltava: (a) a chamada no login
-- (restaurada como ROTA /aceite + gate no guard — NUNCA modal no root, evita a causa
-- provável do #126: o #124 renderizava em TODA página, inclusive login/públicas), e aqui:
--   (b) a versão vigente em TABELA DE PARÂMETRO (o modal órfão gravava '1.1' hardcoded —
--       foi assim que a base ficou meio-preenchida; SPEC exige parâmetro);
--   (c) o enquadramento legal da IA.

-- 1) Versão vigente em PARÂMETRO (nunca hardcoded). Linha única (CHECK id garante 1 linha).
--    Decisão CEO: vigente = 1.2 → TODOS reaceitam no próximo login (inclusive os 8 de abril,
--    que não gravaram granular nem IP; com 1.2 a base nasce íntegra em vez de meio-preenchida).
CREATE TABLE IF NOT EXISTS public.lgpd_versao_vigente (
  id                 boolean PRIMARY KEY DEFAULT true,
  termos_versao      text NOT NULL,
  privacidade_versao text NOT NULL,
  vigente_desde      timestamptz NOT NULL DEFAULT now(),
  observacao         text,
  CONSTRAINT lgpd_versao_vigente_single_row CHECK (id)
);
INSERT INTO public.lgpd_versao_vigente (id, termos_versao, privacidade_versao, observacao)
VALUES (true, '1.2', '1.2', 'v1.2: gate restaurado (rota /aceite); captura granular+IP+UA; IA reenquadrada como execução de contrato')
ON CONFLICT (id) DO UPDATE SET
  termos_versao = EXCLUDED.termos_versao,
  privacidade_versao = EXCLUDED.privacidade_versao,
  vigente_desde = now(),
  observacao = EXCLUDED.observacao;
GRANT SELECT ON public.lgpd_versao_vigente TO authenticated, anon;

-- 2) Enquadramento da IA (decisão CEO, alinhada à LGPD): o ERP é AI-native, a IA é CONDIÇÃO
--    DE USO → a base legal correta é EXECUÇÃO DE CONTRATO, não consentimento (consentimento
--    obrigatório não é livre → não é válido, Art. 8º §1º; um aceite decorativo não sustenta
--    fiscalização). 'execucao_contrato' já é base_legal em uso (FK lgpd_bases_legais ok).
--    ⚠️ A cláusula de IA já existe em /termos §3.2(d) e /privacidade §5 (o que é enviado,
--    provedor Anthropic, não-treinamento) → o enquadramento tem lastro. A tabela de bases
--    legais textual de /privacidade e o §5.4 (opt-out) seguem em revisão do jurídico.
UPDATE public.lgpd_finalidades_tratamento
   SET base_legal_id = 'execucao_contrato',
       exige_consentimento_explicito = false,
       atualizado_em = now()
 WHERE id = 'analise_ia_dre';

-- 3) Leitura da versão vigente — fonte ÚNICA para o guard e o server action (nada hardcoded).
CREATE OR REPLACE FUNCTION public.fn_lgpd_versao_vigente()
 RETURNS TABLE(termos_versao text, privacidade_versao text, vigente_desde timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT termos_versao, privacidade_versao, vigente_desde FROM public.lgpd_versao_vigente WHERE id LIMIT 1;
$function$;
GRANT EXECUTE ON FUNCTION public.fn_lgpd_versao_vigente() TO authenticated, anon;

-- 4) O GATE: o usuário logado precisa (re)aceitar? true se NÃO tem consolidado não-revogado
--    NA VERSÃO VIGENTE. Usa auth.uid() — o guard chama sem argumentos. Sessão ausente → false
--    (o guard-cliente cuida de quem não está logado; páginas públicas não são bloqueadas).
CREATE OR REPLACE FUNCTION public.fn_lgpd_consentimento_pendente()
 RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_t   text;
  v_p   text;
  v_ok  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  SELECT termos_versao, privacidade_versao INTO v_t, v_p FROM public.lgpd_versao_vigente WHERE id LIMIT 1;
  IF v_t IS NULL THEN
    RETURN false;  -- sem parâmetro configurado → não trava o sistema
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.lgpd_consentimentos
     WHERE user_id = v_uid
       AND coalesce(revogado, false) = false
       AND termos_versao = v_t
       AND privacidade_versao = v_p
       AND aceite_termos IS TRUE
       AND aceite_privacidade IS TRUE
  ) INTO v_ok;
  RETURN NOT v_ok;
END
$function$;
GRANT EXECUTE ON FUNCTION public.fn_lgpd_consentimento_pendente() TO authenticated;
