-- SEGURANÇA P1 (Eng. Chefe 17/10, RD-97): o segredo do robô (header x-watcher-secret) estava escrito no corpo de
-- 8 funções (visível a quem lê definições). Passa a ser lido do cofre (vault, nome screen_watcher_secret) por
-- fn_watcher_secret(), que não é executável por anon/authenticated.
-- O valor NUNCA aparece neste arquivo: o bloco abaixo lê o literal vigente das próprias funções, grava no cofre
-- (se o nome ainda não existir) e troca o literal nas funções pela chamada. Assim o disparo segue funcionando até o
-- CEO girar o valor (vault.update_secret + WATCHER_SECRET_NOVO na Vercel). Idempotente.

CREATE OR REPLACE FUNCTION public.fn_watcher_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'screen_watcher_secret' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_watcher_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_watcher_secret() TO service_role;

DO $mig$
DECLARE
  r record;
  def text;
  novo text;
  lit text;
BEGIN
  -- 1) semeia o cofre com o literal vigente (se ainda não houver)
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'screen_watcher_secret') THEN
    SELECT (regexp_match(pg_get_functiondef(p.oid), $re$'x-watcher-secret'\s*,\s*'([^']+)'$re$))[1]
      INTO lit
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'fn_auditor_disparar'
       AND pg_get_functiondef(p.oid) ~ $re$'x-watcher-secret'\s*,\s*'[^']+'$re$
     LIMIT 1;
    IF lit IS NOT NULL THEN
      PERFORM vault.create_secret(lit, 'screen_watcher_secret', 'Segredo x-watcher-secret do robô (screen-watcher/Gold)');
    END IF;
  END IF;

  -- 2) troca o literal nas funções
  FOR r IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname <> 'fn_watcher_secret'
       AND pg_get_functiondef(p.oid) ~* 'x-watcher-secret'
  LOOP
    def := pg_get_functiondef(r.oid);
    novo := regexp_replace(def, $re$'x-watcher-secret'\s*,\s*'[^']+'$re$, $rp$'x-watcher-secret', public.fn_watcher_secret()$rp$, 'g');
    novo := regexp_replace(novo, $re$(x-watcher-secret:\s*)[^\s,)]+$re$, $rp$\1<valor no cofre: screen_watcher_secret>$rp$, 'g');
    IF novo <> def THEN
      EXECUTE novo;
    END IF;
  END LOOP;
END
$mig$;
