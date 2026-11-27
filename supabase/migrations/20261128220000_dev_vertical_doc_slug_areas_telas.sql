-- Saneamento Fase 3 (telas reais) — Central de Dev: lista de verticais ↔ documento vivo (spec do CEO, 27/11).
--
-- Problema provado na tela (27/11): em /dashboard/dev › Desenvolvimento › "Documento vivo da vertical", Industrial
-- mostrava "Ainda não há documento vivo", porque dev_vertical.slug = 'industrial' e o documento está em
-- erp_documento_vertical.vertical = 'industria' (V15 vigente). O documento NÃO é renomeado
-- (fn_codes_blueprint_vertical já mapeia industrial → industria): a vertical passa a dizer onde está o documento.
--
-- 1. dev_vertical.doc_slug     — vertical do documento em erp_documento_vertical (NULL = slug).
--    dev_vertical.areas_telas  — áreas de system_screens contadas na auditoria (NULL = {slug}).
-- 2. Seeds: industrial (doc 'industria', áreas industrial+industria), hub (hub+hub_construcao), revenda_veiculos (revenda);
--    linhas novas ecommerce (áreas commerce) e infraestrutura, que já têm documento vigente.
-- 3. fn_dev_vertical_auditoria_status filtra por areas_telas; sem linha em dev_vertical, vale o CASE de antes (fallback).
-- 4. "?" (RD-95) dos dois campos novos do "Gerenciar verticais".
--
-- Aditiva e idempotente. Não toca erp_documento_vertical, coleta nem ETL. Aprovar/Revogar não mudam: a tela passa o
-- COALESCE(doc_slug, slug) para fn_dev_documento_aprovar/desaprovar. RD-52: nome do arquivo = versão do ledger.

ALTER TABLE public.dev_vertical ADD COLUMN IF NOT EXISTS doc_slug text;
ALTER TABLE public.dev_vertical ADD COLUMN IF NOT EXISTS areas_telas text[];

COMMENT ON COLUMN public.dev_vertical.doc_slug IS
  'Vertical do documento vivo em erp_documento_vertical.vertical. NULL = usa o slug.';
COMMENT ON COLUMN public.dev_vertical.areas_telas IS
  'Áreas de system_screens.area contadas na auditoria da vertical. NULL = {slug}.';

-- Seeds: só preenche o que ainda está vazio (preserva edição feita pela tela).
UPDATE public.dev_vertical SET doc_slug = 'industria'
 WHERE slug = 'industrial' AND doc_slug IS NULL;
UPDATE public.dev_vertical SET areas_telas = ARRAY['industrial','industria']
 WHERE slug = 'industrial' AND areas_telas IS NULL;
UPDATE public.dev_vertical SET areas_telas = ARRAY['hub','hub_construcao']
 WHERE slug = 'hub' AND areas_telas IS NULL;
UPDATE public.dev_vertical SET areas_telas = ARRAY['revenda']
 WHERE slug = 'revenda_veiculos' AND areas_telas IS NULL;

INSERT INTO public.dev_vertical (slug, nome, ordem, areas_telas)
VALUES ('ecommerce', 'E-commerce', 55, ARRAY['commerce']),
       ('infraestrutura', 'Infraestrutura', 160, NULL)
ON CONFLICT (slug) DO NOTHING;

-- Auditoria: áreas da vertical vêm de dev_vertical.areas_telas (NULL = {slug}); vertical fora de dev_vertical usa o CASE
-- antigo (hub_construcao→hub, revenda→revenda_veiculos). Mesmo retorno, mesma guarda (service_role ou PS admin).
CREATE OR REPLACE FUNCTION public.fn_dev_vertical_auditoria_status(p_vertical text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH dv AS (
    SELECT COALESCE(d.areas_telas, ARRAY[d.slug]) AS areas
      FROM public.dev_vertical d WHERE d.slug = p_vertical
  ),
  v AS (
    SELECT s.id, s.rota, s.titulo,
      EXISTS (SELECT 1 FROM public.gold_screen_buttons g WHERE g.screen_id = s.id) AS tem_gold
    FROM public.system_screens s
    WHERE CASE
            WHEN EXISTS (SELECT 1 FROM dv) THEN EXISTS (SELECT 1 FROM dv WHERE s.area = ANY(dv.areas))
            ELSE CASE s.area WHEN 'hub_construcao' THEN 'hub' WHEN 'revenda' THEN 'revenda_veiculos' ELSE s.area END = p_vertical
          END
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

-- Mesmos grants de hoje (authenticated + service_role; anon/PUBLIC sem acesso).
REVOKE ALL ON FUNCTION public.fn_dev_vertical_auditoria_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_dev_vertical_auditoria_status(text) TO authenticated, service_role;

-- RD-95: "?" dos campos novos do "Gerenciar verticais" (texto novo, nenhuma linha existente alterada).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('dev.verticais.doc_slug', '/dashboard/dev', 'Gerenciar verticais', 'Documento vivo (vertical do documento)',
   'O nome com que o documento vivo desta vertical está guardado. Deixe em branco quando é igual ao slug.',
   'Diz à Central de Dev qual documento abrir, aprovar e revogar para esta vertical. A vertical só aparece na lista se houver documento vigente com esse nome.',
   'Industrial: slug "industrial", documento "industria".',
   'Preencher com um nome que não tem documento: a vertical some da lista até o documento existir.',
   'dev', 1),
  ('dev.verticais.areas_telas', '/dashboard/dev', 'Gerenciar verticais', 'Áreas das telas',
   'As áreas do catálogo de telas que pertencem a esta vertical, separadas por vírgula. Deixe em branco para usar só o slug.',
   'Define quais telas entram na auditoria da vertical (total, auditadas e telas sem botão).',
   'Industrial: industrial, industria (24 + 11 telas).',
   'Esquecer uma área: as telas dela ficam fora da contagem da auditoria.',
   'dev', 2)
ON CONFLICT (chave) DO NOTHING;
