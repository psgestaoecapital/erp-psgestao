-- PDCA automático · fatia A (CEO 09/10, msg 5ae18d7b): falha de jornada vira item de fila para o Code dono,
-- sem duplicar; o ciclo seguinte reconfere e fecha sozinho. Aditiva: 1 tabela NOVA (RLS ligada, sem policy,
-- REVOKE anon/authenticated), 1 função NOVA (só service_role) e 1 view NOVA.
-- NÃO escreve em erp_agente_mensagem: a caixa só aceita remetente eng_chefe/ceo (canal protegido); o envio da
-- falha à caixa do dono fica com o Eng. Chefe, que lê esta fila (decisão pendente registrada na caixa).
-- Code: gilberto-chamados

CREATE TABLE IF NOT EXISTS public.pdca_falha (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical      text NOT NULL,
  passo_id      uuid NOT NULL REFERENCES public.pdca_jornada_passo(id) ON DELETE CASCADE,
  chave_dedup   text NOT NULL,
  code_dono     text NOT NULL,
  status        text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','fechada')),
  diagnostico   text,
  ocorrencias   int NOT NULL DEFAULT 1,
  aberta_em     timestamptz NOT NULL DEFAULT now(),
  vista_em      timestamptz NOT NULL DEFAULT now(),
  fechada_em    timestamptz,
  UNIQUE (vertical, chave_dedup)
);
ALTER TABLE public.pdca_falha ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pdca_falha FROM anon, authenticated;

-- ci-sem-guarda: fn_pdca_falhas_consolidar — só service_role (rotina/robô); lê o último resultado de cada passo
CREATE OR REPLACE FUNCTION public.fn_pdca_falhas_consolidar(p_vertical text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v_abertas int := 0; v_novas int := 0; v_fechadas int := 0; v_n int;
BEGIN
  SET LOCAL statement_timeout = '10s';
  FOR r IN
    SELECT j.vertical, s.id passo_id, u.status, u.diagnostico,
           CASE j.vertical WHEN 'hub' THEN 'gilberto-chamados' WHEN 'ge' THEN 'gilberto-desenv' ELSE 'gilberto-desenv' END AS dono
    FROM pdca_jornada j
    JOIN pdca_jornada_passo s ON s.jornada_id = j.id
    JOIN LATERAL (SELECT status, diagnostico FROM pdca_jornada_resultado WHERE passo_id = s.id ORDER BY avaliado_em DESC LIMIT 1) u ON true
    WHERE j.ativa AND (p_vertical IS NULL OR j.vertical = p_vertical)
  LOOP
    IF r.status IN ('vermelho','erro') THEN
      INSERT INTO pdca_falha(vertical, passo_id, chave_dedup, code_dono, diagnostico)
      VALUES (r.vertical, r.passo_id, md5(r.passo_id::text), r.dono, r.diagnostico)
      ON CONFLICT (vertical, chave_dedup) DO UPDATE
        SET diagnostico = EXCLUDED.diagnostico, vista_em = now(),
            ocorrencias = CASE WHEN pdca_falha.status = 'aberta' THEN pdca_falha.ocorrencias + 1 ELSE 1 END,
            status = 'aberta', fechada_em = NULL,
            aberta_em = CASE WHEN pdca_falha.status = 'fechada' THEN now() ELSE pdca_falha.aberta_em END
      RETURNING (xmax = 0)::int INTO STRICT v_n;
      v_abertas := v_abertas + 1;
      IF v_n = 1 THEN v_novas := v_novas + 1; END IF;
    ELSIF r.status = 'verde' THEN
      UPDATE pdca_falha SET status = 'fechada', fechada_em = now(), vista_em = now()
      WHERE vertical = r.vertical AND chave_dedup = md5(r.passo_id::text) AND status = 'aberta';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_fechadas := v_fechadas + v_n;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'abertas_vistas', v_abertas, 'novas', v_novas, 'fechadas', v_fechadas);
END $function$;
REVOKE ALL ON FUNCTION public.fn_pdca_falhas_consolidar(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.vw_pdca_falha_aberta WITH (security_invoker = true) AS
SELECT vertical, code_dono, count(*) AS abertas, max(ocorrencias) AS maior_reincidencia, min(aberta_em) AS mais_antiga
FROM pdca_falha WHERE status = 'aberta' GROUP BY vertical, code_dono;
REVOKE ALL ON public.vw_pdca_falha_aberta FROM anon, authenticated;
