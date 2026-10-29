-- Etiqueta auditada_ok em system_screens (CEO 29/10): tela com nota >= 95 sai do escopo do auditor
-- até um deploy mudá-la. ADITIVA (RD-94.1 c): colunas novas + 2 funções novas; nada existente é recriado.
ALTER TABLE public.system_screens
  ADD COLUMN IF NOT EXISTS auditada_ok boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auditada_ok_em timestamptz,
  ADD COLUMN IF NOT EXISTS auditada_ok_commit text,
  ADD COLUMN IF NOT EXISTS auditada_ok_por text,
  ADD COLUMN IF NOT EXISTS auditada_ok_nota numeric;

CREATE INDEX IF NOT EXISTS idx_system_screens_auditada_ok
  ON public.system_screens (rota) WHERE auditada_ok;

CREATE OR REPLACE FUNCTION public.fn_tela_auditada_ok_marcar(
  p_rota text, p_commit text, p_nota numeric, p_por text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_nota IS NULL OR p_nota < 95 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nota_abaixo_de_95');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM system_screens WHERE rota = p_rota) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'rota_inexistente');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM module_catalog WHERE ativo AND rota = p_rota) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'fora_do_menu');
  END IF;
  UPDATE system_screens
     SET auditada_ok = true, auditada_ok_em = now(), auditada_ok_commit = p_commit,
         auditada_ok_por = p_por, auditada_ok_nota = p_nota
   WHERE rota = p_rota;
  RETURN jsonb_build_object('ok', true, 'rota', p_rota, 'nota', p_nota, 'commit', p_commit);
END $$;

CREATE OR REPLACE FUNCTION public.fn_tela_auditada_ok_limpar(p_rota text, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n int;
BEGIN
  UPDATE system_screens
     SET auditada_ok = false, auditada_ok_em = NULL, auditada_ok_commit = NULL,
         auditada_ok_por = NULL, auditada_ok_nota = NULL
   WHERE rota = p_rota AND auditada_ok;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'rota', p_rota, 'limpas', v_n, 'motivo', p_motivo);
END $$;

REVOKE ALL ON FUNCTION public.fn_tela_auditada_ok_marcar(text, text, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tela_auditada_ok_limpar(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tela_auditada_ok_marcar(text, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tela_auditada_ok_limpar(text, text) TO service_role;

-- ci-sem-guarda: fn_tela_auditada_ok_marcar — system_screens é catálogo global (sem empresa); EXECUTE só service_role (REVOKE PUBLIC/anon/authenticated). p_nota/p_por são ferramenta interna do auditor (service_role), não evidência de usuário.
-- ci-sem-guarda: fn_tela_auditada_ok_limpar — system_screens é catálogo global (sem empresa); EXECUTE só service_role (REVOKE PUBLIC/anon/authenticated).
