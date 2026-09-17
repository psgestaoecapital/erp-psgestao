-- Auditoria (screen-watcher) travada pelo ConsentGuard: o Screenshot Bot (is_robo, screenshot@psgestao.com)
-- navega com o SCREENSHOT_USER_TOKEN; ele tinha consentimento de versão ANTIGA, então
-- fn_lgpd_consentimento_pendente() devolvia TRUE → o ConsentGuard (client) o jogava em /aceite → a
-- auditoria fotografava /aceite no lugar das telas reais (falso "redirect").
--
-- Fix correto (não registrar consentimento p/ bot — isso seria aceite falso, sem valor jurídico, e
-- travaria de novo a cada nova versão de termos): EXEMPTAR robôs. Consentimento é ato de PESSOA.
CREATE OR REPLACE FUNCTION public.fn_lgpd_consentimento_pendente()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  -- robô (ex.: Screenshot Bot da auditoria) nunca é "pendente": consentimento é ato de pessoa,
  -- não de conta técnica. Sem isso, o auditor cai no /aceite e não entra nas telas.
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_uid AND coalesce(is_robo, false)) THEN
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
