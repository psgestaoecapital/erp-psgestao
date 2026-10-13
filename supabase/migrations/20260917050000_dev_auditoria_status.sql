-- ⑧ (CEO) · o botão de auditar a vertical dizia "20/20" e o CEO lia como "auditou tudo", sem ver que são
-- 46 telas na GE e só 20 têm botão-ouro. Falha de VERDADE do número, não do robô: RD-38 confirmou que as
-- 20 telas auditáveis da GE foram TODAS validadas pela Camada 2 (Gold jornada) nas últimas 24h — o "3" que
-- o CEO viu era o auditor VISUAL (system_screens_insights), outro robô agendado, não o que o botão dispara.
--
-- Esta função dá o NÚMERO VERDADEIRO por vertical, medindo pela cadeia CERTA (a que o botão alimenta):
--   gold_screen_buttons.botao → gold_camada2_validacoes. Decisão CEO: mostrar "X de <total>" com as telas
--   sem botão marcadas "sem auditoria" (o denominador é o SISTEMA, não a capacidade do robô — mostrar
--   "20 de 20" faria a GE parecer 100% quando 57% das telas ninguém testa).
--   total        = telas da vertical (GE = 46)
--   auditaveis   = têm botão-ouro (GE = 20) · sem_botao = total - auditaveis (GE = 26)
--   auditadas    = telas auditáveis cujos botões-ouro têm validação Camada 2 (o que REALMENTE foi exercitado)
--   ultima_em    = última validação Camada 2 na vertical
--   sem_botao_lista = as telas sem botão (rota + título), para a tela LISTAR quais são (o CEO pediu clicável).

CREATE OR REPLACE FUNCTION public.fn_dev_vertical_auditoria_status(p_vertical text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH v AS (
    SELECT s.id, s.rota, s.titulo,
      EXISTS (SELECT 1 FROM public.gold_screen_buttons g WHERE g.screen_id = s.id) AS tem_gold
    FROM public.system_screens s
    WHERE CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END = p_vertical
  )
  SELECT jsonb_build_object(
    'vertical',   p_vertical,
    'total',      (SELECT count(*) FROM v),
    'auditaveis', (SELECT count(*) FROM v WHERE tem_gold),
    'sem_botao',  (SELECT count(*) FROM v WHERE NOT tem_gold),
    'auditadas',  (SELECT count(DISTINCT b.screen_id)
                     FROM public.gold_screen_buttons b
                     JOIN public.gold_camada2_validacoes val ON val.botao_id = b.id
                     WHERE b.screen_id IN (SELECT id FROM v WHERE tem_gold)),
    'ultima_em',  (SELECT max(val.executado_em)
                     FROM public.gold_screen_buttons b
                     JOIN public.gold_camada2_validacoes val ON val.botao_id = b.id
                     WHERE b.screen_id IN (SELECT id FROM v)),
    'sem_botao_lista', (SELECT COALESCE(jsonb_agg(jsonb_build_object('rota', rota, 'titulo', titulo) ORDER BY rota), '[]'::jsonb)
                          FROM v WHERE NOT tem_gold)
  )
  FROM (SELECT 1) _
  WHERE (auth.role() = 'service_role' OR public.fn_eh_ps_admin());
$function$;
GRANT EXECUTE ON FUNCTION public.fn_dev_vertical_auditoria_status(text) TO authenticated, service_role;
