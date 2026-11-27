-- feat(hub/obras/partes · §314 · RD-98 p1+p3): seed DEMO das partes da obra + origem do dado
--
-- Gap PDCA aud8 (21/11, 94/95) em /dashboard/projetos/obras/[id]/partes:
--   p1 (sem tela morta): projetos_obra_parte = 0 linhas -> a tela abre vazia na DEMO Construtora,
--     a jornada não prova a lista com dado real.
--   p3 (origem do dado): system_screens.rpcs_chamadas = NULL embora a tela chame 3 RPCs reais
--     (fn_obra_parte_listar / _salvar / _excluir).
--
-- Aditivo, sem DDL. Seed SÓ-DEMO: toda escrita guardada pela empresa Construtora Modelo - DEMO
-- (b0700000-0000-4000-a000-000000000006, is_demo=true) e por obras que pertencem a ela.
-- Idempotente por (obra_id, papel, nome) — re-rodar não duplica.
--
-- Prova RD-38 (dry count em produção, sem gravar): 9 linhas candidatas, todas passam na guarda
-- (obra pertence à empresa DEMO) e nenhuma já existe. system_screens é metadado global (idempotente
-- por rpcs_chamadas IS NULL).

-- 1) Origem do dado (metadado global, aditivo e idempotente)
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_obra_parte_listar','fn_obra_parte_salvar','fn_obra_parte_excluir'],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/obras/[id]/partes'
   AND rpcs_chamadas IS NULL;

-- 2) Seed DEMO idempotente das partes da obra (duplamente guardado: empresa DEMO + obra da empresa)
DO $$
DECLARE
  v_company uuid := 'b0700000-0000-4000-a000-000000000006';   -- Construtora Modelo - DEMO
  v_obra_vista uuid := '11a80fcc-0c9c-492b-b993-08df3a74fd77'; -- Forro e divisórias – Vista Verde
  v_obra_clin  uuid := 'ecef61b7-77d1-45d1-ba9c-49f35e25b932'; -- Piso e pintura – Clínica Bem Viver
  r record;
BEGIN
  -- trava so-demo: só prossegue se a empresa for mesmo DEMO
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company AND c.is_demo = true) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      (v_obra_vista, 'proprietario',          'Condomínio Residencial Vista Verde', '12.345.678/0001-90', 'sindico@vistaverde.demo'),
      (v_obra_vista, 'contratante',           'Vista Verde Incorporações Ltda',     '12.345.678/0001-90', 'obras@vistaverde.demo'),
      (v_obra_vista, 'construtora_executora', 'Construtora Modelo Ltda',            '98.765.432/0001-10', 'engenharia@construtoramodelo.demo'),
      (v_obra_vista, 'escritorio_gestor',     'Gestão & Obras Engenharia',          '45.678.912/0001-33', 'contato@gestaoeobras.demo'),
      (v_obra_vista, 'representante',          'Eng. Marcos Andrade (CREA 123456)',  '123.456.789-00',     'marcos.andrade@construtoramodelo.demo'),
      (v_obra_clin,  'proprietario',          'Clínica Bem Viver S/A',              '23.456.789/0001-01', 'administracao@bemviver.demo'),
      (v_obra_clin,  'contratante',           'Clínica Bem Viver S/A',              '23.456.789/0001-01', 'obras@bemviver.demo'),
      (v_obra_clin,  'construtora_executora', 'Construtora Modelo Ltda',            '98.765.432/0001-10', 'engenharia@construtoramodelo.demo'),
      (v_obra_clin,  'escritorio_gestor',     'Gestão & Obras Engenharia',          '45.678.912/0001-33', 'contato@gestaoeobras.demo')
    ) AS t(obra_id, papel, nome, documento, contato)
  LOOP
    IF EXISTS (SELECT 1 FROM public.projetos_obras o WHERE o.id = r.obra_id AND o.company_id = v_company)
       AND NOT EXISTS (
         SELECT 1 FROM public.projetos_obra_parte p
          WHERE p.obra_id = r.obra_id AND p.papel = r.papel AND p.nome = r.nome
       ) THEN
      INSERT INTO public.projetos_obra_parte (company_id, obra_id, papel, nome, documento, contato)
      VALUES (v_company, r.obra_id, r.papel, r.nome, r.documento, r.contato);
    END IF;
  END LOOP;
END $$;
