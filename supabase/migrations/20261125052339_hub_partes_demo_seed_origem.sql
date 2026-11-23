-- PDCA Hub · RD-98 · tela Partes da obra (/dashboard/projetos/obras/[id]/partes)
-- Code: code-desenvolvedor-3
--
-- Problema (auditor_pdca_1, 22/11 · aud8 94/95, verificado na main + DEMO Construtora
-- b0700000-0000-4000-a000-000000000006):
--   1) RD-98 p1 — SEM DADO: projetos_obra_parte tem 0 linhas em TODO o banco; a tela só
--      renderiza o estado-vazio, sem lista populada para provar o CRUD real.
--   2) RD-98 p3 — ORIGEM DO DADO: system_screens da rota está com rpcs_chamadas e
--      views_consumidas VAZIOS, embora a page.tsx (#5810) chame as 3 RPCs guardadas
--      fn_obra_parte_listar / fn_obra_parte_salvar / fn_obra_parte_excluir.
--
-- AÇÃO (aditiva, idempotente, NÃO toca núcleo nem dado de cliente):
--   A) SEED só na DEMO (guardado por company_id = b0700000-…006, padrão das demais seeds
--      DEMO): proprietario + contratante + construtora_executora por obra, nas 7 obras da
--      Construtora DEMO. Reaplicar NÃO duplica (NOT EXISTS por obra_id+papel vivo).
--   B) Catálogo: preenche rpcs_chamadas e views_consumidas da rota em system_screens
--      (espelha a receita da #5856 em /orcamento/relatorios). UPDATE idempotente.
--
-- Fontes conferidas no dado (RD-38):
--   schema projetos_obra_parte: papel CHECK in
--     (proprietario, contratante, construtora_executora, escritorio_gestor, representante);
--     company_id/obra_id/papel/nome NOT NULL; soft-delete por excluido_em.
--   RPCs existem: fn_obra_parte_listar(uuid), fn_obra_parte_salvar(uuid,uuid,text,text,text,text,text),
--                 fn_obra_parte_excluir(uuid,text).
--   7 obras DEMO vivas (deleted_at IS NULL) conferidas por id.
--
-- RD-38 (provado em BEGIN…ROLLBACK, statement_timeout curto):
--   ANTES  projetos_obra_parte vivas da DEMO = 0 ; system_screens da rota com arrays NULL.
--   DEPOIS vivas da DEMO = 21 (7 obras × 3 papéis) ; arrays preenchidos ; re-run insere 0.

-- ── A) SEED das partes na DEMO Construtora ──────────────────────────────────
INSERT INTO public.projetos_obra_parte
  (company_id, obra_id, papel, nome, documento, contato, observacao)
SELECT
  'b0700000-0000-4000-a000-000000000006'::uuid,
  v.obra_id::uuid, v.papel, v.nome, v.documento, v.contato, v.observacao
FROM (VALUES
  -- 1) Forro e divisórias – Vista Verde
  ('11a80fcc-0c9c-492b-b993-08df3a74fd77','proprietario','Condomínio Residencial Vista Verde','12.345.678/0001-90','sindico@vistaverde.demo.local','Proprietário do empreendimento (dado fictício DEMO)'),
  ('11a80fcc-0c9c-492b-b993-08df3a74fd77','contratante','Administradora Vista Verde Ltda','23.456.789/0001-01','obras@adminvistaverde.demo.local','Administradora que contratou a obra (dado fictício DEMO)'),
  ('11a80fcc-0c9c-492b-b993-08df3a74fd77','construtora_executora','Forros & Divisórias Horizonte Ltda','34.567.890/0001-12','contato@fdhorizonte.demo.local','Executora do forro e das divisórias (dado fictício DEMO)'),
  -- 2) Mercado Central Demo
  ('304678f8-7b38-424a-af9c-19e28ed94364','proprietario','Mercado Central Demo S/A','45.678.901/0001-23','diretoria@mercadocentral.demo.local','Proprietário do imóvel comercial (dado fictício DEMO)'),
  ('304678f8-7b38-424a-af9c-19e28ed94364','contratante','Rede Central de Varejo Ltda','56.789.012/0001-34','expansao@redecentral.demo.local','Rede que contratou a obra (dado fictício DEMO)'),
  ('304678f8-7b38-424a-af9c-19e28ed94364','construtora_executora','Construtora Praça Nova Ltda','67.890.123/0001-45','obras@pracanova.demo.local','Executora da obra (dado fictício DEMO)'),
  -- 3) ORBA TESTE
  ('f5bd22cb-8bea-4676-a7d3-687d874ba90b','proprietario','Incorporadora Orba Ltda','78.901.234/0001-56','contato@incorbra.demo.local','Proprietário do terreno (dado fictício DEMO)'),
  ('f5bd22cb-8bea-4676-a7d3-687d874ba90b','contratante','Orba Empreendimentos Ltda','89.012.345/0001-67','empreend@orba.demo.local','Contratante do empreendimento (dado fictício DEMO)'),
  ('f5bd22cb-8bea-4676-a7d3-687d874ba90b','construtora_executora','Construtora Orba Obras Ltda','90.123.456/0001-78','obras@orbaobras.demo.local','Executora da obra (dado fictício DEMO)'),
  -- 4) Piso e pintura – Clínica Bem Viver
  ('ecef61b7-77d1-45d1-ba9c-49f35e25b932','proprietario','Clínica Bem Viver Ltda','01.234.567/0001-89','administracao@bemviver.demo.local','Proprietária do imóvel (dado fictício DEMO)'),
  ('ecef61b7-77d1-45d1-ba9c-49f35e25b932','contratante','Dra. Helena Marques','123.456.789-00','helena.marques@bemviver.demo.local','Responsável que contratou o acabamento (dado fictício DEMO)'),
  ('ecef61b7-77d1-45d1-ba9c-49f35e25b932','construtora_executora','Acabamentos Bem Feito Ltda','11.222.333/0001-44','contato@bemfeito.demo.local','Executora do piso e da pintura (dado fictício DEMO)'),
  -- 5) Piso industrial – câmara fria e expedição · Frigorífico Oeste
  ('5a016907-af97-4736-bea4-8057380f3966','proprietario','Frigorífico Oeste S/A','22.333.444/0001-55','engenharia@frigooeste.demo.local','Proprietário da planta industrial (dado fictício DEMO)'),
  ('5a016907-af97-4736-bea4-8057380f3966','contratante','Oeste Alimentos Ltda','33.444.555/0001-66','projetos@oestealimentos.demo.local','Contratante da obra (dado fictício DEMO)'),
  ('5a016907-af97-4736-bea4-8057380f3966','construtora_executora','Pisos Industriais Resiforte Ltda','44.555.666/0001-77','comercial@resiforte.demo.local','Executora do piso industrial (dado fictício DEMO)'),
  -- 6) Reforma loja – Mercado Central
  ('0e995085-560d-4f30-be11-99a4cfdb9608','proprietario','Mercado Central Demo S/A','45.678.901/0001-23','diretoria@mercadocentral.demo.local','Proprietário do imóvel comercial (dado fictício DEMO)'),
  ('0e995085-560d-4f30-be11-99a4cfdb9608','contratante','Rede Central de Varejo Ltda','56.789.012/0001-34','expansao@redecentral.demo.local','Rede que contratou a reforma (dado fictício DEMO)'),
  ('0e995085-560d-4f30-be11-99a4cfdb9608','construtora_executora','Reforma Já Construções Ltda','55.666.777/0001-88','obras@reformaja.demo.local','Executora da reforma da loja (dado fictício DEMO)'),
  -- 7) Sala comercial – Horizonte
  ('51db2096-e659-4bf4-84fb-3dab98746ba6','proprietario','Edifício Horizonte Corporate','66.777.888/0001-99','condominio@horizontecorp.demo.local','Proprietário da sala comercial (dado fictício DEMO)'),
  ('51db2096-e659-4bf4-84fb-3dab98746ba6','contratante','Horizonte Negócios Imobiliários Ltda','77.888.999/0001-10','obras@horizontenegocios.demo.local','Contratante da obra (dado fictício DEMO)'),
  ('51db2096-e659-4bf4-84fb-3dab98746ba6','construtora_executora','Construtora Horizonte Ltda','88.999.000/0001-21','contato@construtorahorizonte.demo.local','Executora da obra (dado fictício DEMO)')
) AS v(obra_id, papel, nome, documento, contato, observacao)
-- só semeia em obra que é mesmo da Construtora DEMO (trava dupla com a FK)
WHERE EXISTS (
  SELECT 1 FROM public.projetos_obras o
  WHERE o.id = v.obra_id::uuid
    AND o.company_id = 'b0700000-0000-4000-a000-000000000006'::uuid
)
AND NOT EXISTS (
  SELECT 1 FROM public.projetos_obra_parte p
  WHERE p.obra_id = v.obra_id::uuid
    AND p.papel   = v.papel
    AND p.excluido_em IS NULL
);

-- ── B) Origem do dado em system_screens (RD-98 p3) ──────────────────────────
UPDATE public.system_screens
SET rpcs_chamadas   = ARRAY['fn_obra_parte_listar','fn_obra_parte_salvar','fn_obra_parte_excluir']::text[],
    views_consumidas = ARRAY['projetos_obra_parte','projetos_obras']::text[],
    atualizado_em    = now()
WHERE rota = '/dashboard/projetos/obras/[id]/partes';
