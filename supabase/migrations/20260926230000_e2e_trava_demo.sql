-- RD-78 · trava das suítes e2e sobre a Demonstração Revenda (uma demo, várias suítes).
--
-- Prova (26/09 13:12, gold_jornada_resultado): o Juiz pós-merge em PRODUÇÃO (run 36244034978) e a aceitação
-- do PREVIEW do #1826 (run 36244291934) rodaram as MESMAS jornadas no MESMO segundo, na mesma empresa demo.
-- O teste A (foto) de cada um limpou a galeria do outro: 1ª tentativa "objeto não existe no Storage", retry
-- "esperava 0 fotos, veio 1". Tudo o mais passou nos dois. E o fn_demo_reset do teardown de um pode resetar a
-- demo no meio do outro. Não é flake: é concorrência sem exclusão mútua.
--
-- Arrendamento (lease) com validade: quem pega a trava tem até p_ttl_s segundos; se o job morrer, ela expira
-- sozinha. global-setup pega (espera até ~20 min), global-teardown devolve depois do reset. Só service_role.

CREATE TABLE IF NOT EXISTS public.e2e_trava (
  nome       text PRIMARY KEY,
  dono       text NOT NULL,
  pega_em    timestamptz NOT NULL DEFAULT now(),
  expira_em  timestamptz NOT NULL
);
ALTER TABLE public.e2e_trava ENABLE ROW LEVEL SECURITY;   -- sem policy: só service_role (bypass) enxerga
COMMENT ON TABLE public.e2e_trava IS 'RD-78: exclusão mútua das suítes e2e sobre a empresa demo (lease com validade)';

CREATE OR REPLACE FUNCTION public.fn_e2e_trava_pegar(p_nome text, p_dono text, p_ttl_s integer DEFAULT 1200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v record;
BEGIN
  IF NULLIF(btrim(p_nome),'') IS NULL OR NULLIF(btrim(p_dono),'') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'parametro_vazio'); END IF;
  INSERT INTO e2e_trava (nome, dono, pega_em, expira_em)
  VALUES (p_nome, p_dono, now(), now() + make_interval(secs => GREATEST(COALESCE(p_ttl_s, 1200), 60)))
  ON CONFLICT (nome) DO UPDATE
    SET dono = EXCLUDED.dono, pega_em = EXCLUDED.pega_em, expira_em = EXCLUDED.expira_em
    WHERE e2e_trava.expira_em < now() OR e2e_trava.dono = EXCLUDED.dono;   -- livre, vencida ou já é minha
  SELECT dono, expira_em INTO v FROM e2e_trava WHERE nome = p_nome;
  RETURN jsonb_build_object('ok', v.dono = p_dono, 'dono', v.dono, 'expira_em', v.expira_em);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_e2e_trava_soltar(p_nome text, p_dono text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  DELETE FROM e2e_trava WHERE nome = p_nome AND dono = p_dono;   -- só o dono solta
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n = 1);
END $function$;

REVOKE ALL ON FUNCTION public.fn_e2e_trava_pegar(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_e2e_trava_soltar(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_e2e_trava_pegar(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_e2e_trava_soltar(text, text) TO service_role;
