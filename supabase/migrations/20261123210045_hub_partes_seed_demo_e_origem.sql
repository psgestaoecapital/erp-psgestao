-- Hub · tela 314 /dashboard/projetos/obras/[id]/partes · PDCA (aud8 94/95)
-- Gap 1 (RD-98 p1 SEM TELA MORTA): projetos_obra_parte tem 0 linhas -> toda obra da
--   Construtora Modelo - DEMO (b0700000-...-006) abre a tela no estado vazio e a jornada
--   nao prova a lista com dado real. Semeia partes realistas em 2 obras DEMO.
-- Gap 2 (RD-98 p3 ORIGEM DO DADO): system_screens da rota com rpcs_chamadas/views NULL.
-- SO-DEMO: toda escrita de dado e guardada pelos ids das obras da empresa DEMO 006.
-- Aditiva, idempotente (NOT EXISTS por obra_id+papel+nome). Sem DDL. Code: desenvolvedor_4_g.

DO $$
DECLARE
  v_demo   uuid := 'b0700000-0000-4000-a000-000000000006';
  v_obra1  uuid := '11a80fcc-0c9c-492b-b993-08df3a74fd77'; -- Forro e divisorias - Vista Verde
  v_obra2  uuid := 'ecef61b7-77d1-45d1-ba9c-49f35e25b932'; -- Piso e pintura - Clinica Bem Viver
  r RECORD;
BEGIN
  -- so semeia se as obras realmente pertencem a DEMO 006 (trava de seguranca)
  FOR r IN
    SELECT * FROM (VALUES
      -- obra 1: Forro e divisorias - Vista Verde
      (v_obra1, 'proprietario',          'Condomínio Residencial Vista Verde',        '12.345.678/0001-90', 'síndico@vistaverde.com.br · (44) 3620-1100', 'Dono do empreendimento'),
      (v_obra1, 'contratante',            'Vista Verde Incorporações Ltda',            '12.345.678/0002-71', 'contratos@vistaverde.com.br',               'Contrata a execução'),
      (v_obra1, 'construtora_executora',  'Construtora Modelo Engenharia Ltda',        '98.765.432/0001-10', 'obras@construtoramodelo.com.br',            'Executa forro e divisórias'),
      (v_obra1, 'escritorio_gestor',      'Gestão & Projetos Arquitetura',             '11.222.333/0001-44', 'contato@gestaoprojetos.com.br',             'Fiscaliza e gere o contrato'),
      (v_obra1, 'representante',          'Eng. Carla Menezes (CREA-PR 160842)',       '077.888.999-00',     'carla.menezes@construtoramodelo.com.br',    'Responsável técnico pela executora'),
      -- obra 2: Piso e pintura - Clinica Bem Viver
      (v_obra2, 'proprietario',          'Clínica Bem Viver Saúde Ltda',              '22.333.444/0001-55', 'administrativo@bemviver.com.br',            'Dona do imóvel'),
      (v_obra2, 'contratante',            'Clínica Bem Viver Saúde Ltda',              '22.333.444/0001-55', 'administrativo@bemviver.com.br',            'Mesma empresa contrata a reforma'),
      (v_obra2, 'construtora_executora',  'Construtora Modelo Engenharia Ltda',        '98.765.432/0001-10', 'obras@construtoramodelo.com.br',            'Executa piso e pintura'),
      (v_obra2, 'representante',          'Téc. Rafael Dias (encarregado de obra)',    '055.444.333-22',     'rafael.dias@construtoramodelo.com.br',      'Preposto da executora na obra')
    ) AS t(obra_id, papel, nome, documento, contato, observacao)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.projetos_obras o
      WHERE o.id = r.obra_id AND o.company_id = v_demo AND o.deleted_at IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public.projetos_obra_parte p
      WHERE p.obra_id = r.obra_id AND p.papel = r.papel AND p.nome = r.nome
    ) THEN
      INSERT INTO public.projetos_obra_parte
        (company_id, obra_id, papel, nome, documento, contato, observacao)
      VALUES
        (v_demo, r.obra_id, r.papel, r.nome, r.documento, r.contato, r.observacao);
    END IF;
  END LOOP;
END $$;

-- Gap 2: origem do dado da tela (aditivo; a tela so chama RPC, sem views)
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_obra_parte_listar','fn_obra_parte_salvar','fn_obra_parte_excluir']
 WHERE rota = '/dashboard/projetos/obras/[id]/partes'
   AND rpcs_chamadas IS NULL;
