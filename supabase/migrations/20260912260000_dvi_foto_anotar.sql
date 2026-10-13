-- ============================================================
-- Onda 2 · DVI — anotação na foto (backend)
-- ============================================================
-- A anotação é uma ação PÓS-foto: o mecânico abre uma foto já salva e desenha por cima
-- (círculo na peça gasta, seta no vazamento). O desenho é guardado como VETOR em
-- erp_os_registro_foto.anotacao (jsonb, coluna criada em #1422) — NUNCA queimado no arquivo
-- da imagem. Assim o render (diagnóstico e página pública) desenha o traço por cima na hora,
-- e dá pra apagar/refazer sem perder a foto original (LGPD/prova).
--
-- Convenção do jsonb (o front e o render combinam nisso):
--   { "v": 1, "tracos": [ { "cor": "#A32D2D", "pontos": [[x,y],[x,y],...] } ] }
--   x,y são NORMALIZADOS 0..1 (fração da largura/altura) → renderiza em qualquer tamanho.
--   anotacao = NULL (ou jsonb 'null') limpa a anotação.
--
-- Função NOVA (sem overload anterior — evita a armadilha do ca93f795): assinatura única
-- (uuid, jsonb), sem DEFAULT. Só o mecânico (authenticated) anota; o cliente do link público
-- apenas vê. Guard por empresa igual ao fn_os_foto_excluir.

CREATE OR REPLACE FUNCTION public.fn_os_foto_anotar(p_id uuid, p_anotacao jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_os_registro_foto WHERE id = p_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'foto_inexistente'); END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;

  UPDATE erp_os_registro_foto
     SET anotacao = CASE WHEN p_anotacao IS NULL OR p_anotacao = 'null'::jsonb THEN NULL ELSE p_anotacao END
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_os_foto_anotar(uuid, jsonb) TO authenticated;
