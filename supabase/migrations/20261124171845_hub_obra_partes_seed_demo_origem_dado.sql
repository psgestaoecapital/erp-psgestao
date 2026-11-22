-- Hub · Gestão de Obras · tela 314 "Partes da obra" (/dashboard/projetos/obras/[id]/partes)
-- Fecha 2 gaps do PDCA (auditor_pdca_1, RD-98 p1 "sem tela morta" + p3 "origem do dado"):
--   1) RD-98 p3: system_screens.rpcs_chamadas estava NULL na rota -> sem selo. Preenche (aditivo).
--   2) RD-98 p1: projetos_obra_parte tinha 0 linhas na DEMO -> tela sempre no estado vazio, aud8 não pontua.
--      Semeia partes realistas em 2 obras da Construtora Modelo - DEMO (b0700000-0000-4000-a000-000000000006),
--      cada papel do blueprint 314 (proprietário, contratante, construtora executora, escritório gestor,
--      representante). Idempotente por (obra_id, papel, nome): re-roda sem duplicar.
-- Aditiva, hub-owned. Não toca núcleo nem dado de cliente real; só a empresa DEMO. RD-38 provado no PR.

-- 1) Origem do dado (RD-98 p3): RPCs que a tela chama -------------------------------------------------
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_obra_parte_listar','fn_obra_parte_salvar','fn_obra_parte_excluir']
 WHERE rota = '/dashboard/projetos/obras/[id]/partes'
   AND (rpcs_chamadas IS NULL OR cardinality(rpcs_chamadas) = 0);

-- 2) Seed idempotente das partes nas obras DEMO ------------------------------------------------------
WITH seed(obra_id, papel, nome, documento, contato) AS (
  VALUES
  -- Obra: "Forro e divisórias – Vista Verde"
  ('11a80fcc-0c9c-492b-b993-08df3a74fd77'::uuid, 'proprietario',          'Condomínio Residencial Vista Verde',   '18.432.109/0001-55', 'sindico@vistaverde.com.br · (11) 3222-1100'),
  ('11a80fcc-0c9c-492b-b993-08df3a74fd77'::uuid, 'contratante',           'Vista Verde Incorporadora Ltda',        '22.145.980/0001-07', 'contratos@vistaverdeinc.com.br · (11) 3222-1180'),
  ('11a80fcc-0c9c-492b-b993-08df3a74fd77'::uuid, 'construtora_executora', 'Construtora Alfa Engenharia Ltda',      '09.876.543/0001-21', 'obras@alfaengenharia.com.br · (11) 4002-8900'),
  ('11a80fcc-0c9c-492b-b993-08df3a74fd77'::uuid, 'escritorio_gestor',     'Núcleo Projetos e Gerenciamento Ltda',  '31.502.664/0001-88', 'gestao@nucleoprojetos.com.br · (11) 3030-4040'),
  ('11a80fcc-0c9c-492b-b993-08df3a74fd77'::uuid, 'representante',         'Eng. Marina Costa',                     '321.654.987-00',     'marina.costa@alfaengenharia.com.br · (11) 99810-2233'),
  -- Obra: "Piso e pintura – Clínica Bem Viver"
  ('ecef61b7-77d1-45d1-ba9c-49f35e25b932'::uuid, 'proprietario',          'Clínica Bem Viver Saúde Ltda',          '27.918.400/0001-62', 'administracao@clinicabemviver.com.br · (11) 3555-7788'),
  ('ecef61b7-77d1-45d1-ba9c-49f35e25b932'::uuid, 'contratante',           'Bem Viver Participações Ltda',          '35.880.221/0001-14', 'financeiro@bemviverpart.com.br · (11) 3555-7000'),
  ('ecef61b7-77d1-45d1-ba9c-49f35e25b932'::uuid, 'construtora_executora', 'Reforma & Cor Construções ME',          '44.207.665/0001-39', 'contato@reformaecor.com.br · (11) 2855-3366'),
  ('ecef61b7-77d1-45d1-ba9c-49f35e25b932'::uuid, 'escritorio_gestor',     'Núcleo Projetos e Gerenciamento Ltda',  '31.502.664/0001-88', 'gestao@nucleoprojetos.com.br · (11) 3030-4040'),
  ('ecef61b7-77d1-45d1-ba9c-49f35e25b932'::uuid, 'representante',         'Arq. Rafael Nunes',                     '158.263.470-99',     'rafael.nunes@reformaecor.com.br · (11) 99622-7744')
)
INSERT INTO public.projetos_obra_parte (company_id, obra_id, papel, nome, documento, contato)
SELECT o.company_id, s.obra_id, s.papel, s.nome, s.documento, s.contato
  FROM seed s
  JOIN public.projetos_obras o
    ON o.id = s.obra_id
   AND o.company_id = 'b0700000-0000-4000-a000-000000000006'::uuid  -- SÓ Construtora Modelo - DEMO
   AND o.deleted_at IS NULL
 WHERE NOT EXISTS (
         SELECT 1 FROM public.projetos_obra_parte p
          WHERE p.obra_id = s.obra_id
            AND p.papel   = s.papel
            AND p.nome    = s.nome
            AND p.excluido_em IS NULL
       );
