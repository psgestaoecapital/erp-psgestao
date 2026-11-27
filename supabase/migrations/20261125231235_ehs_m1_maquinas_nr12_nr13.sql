-- ============================================================
-- PS EHS · M1 Estrutura e cadastros · onda E1
-- Máquinas e equipamentos: Inventário NR-12, caldeiras e vasos de pressão NR-13,
-- inspeções + Equipamentos de medição com certificado de calibração.
-- Code: code-desenvolvedor-3
-- ============================================================
-- Requisitos do blueprint_tela_requisito (vertical 'ehs', tela_num 1):
--   • "Máquinas e equipamentos: Inventário NR-12, caldeiras e vasos NR-13, inspeções" (ausente)
--   • "Equipamentos de medição: Com certificado de calibração" (ausente)
-- ADITIVA (RD-94.1 c): tabela/RPCs/menu NOVOS, RLS por empresa, REVOKE anon, sem UPDATE/DELETE
-- em dado de cliente. Idempotente. Seed SÓ na DEMO EHS (b0700000-0000-4000-a000-00000000000b).
-- Nenhum nome de terceiro (RD-100). RD-95: "?" em todo campo (erp_ajuda_campo).

-- ------------------------------------------------------------
-- 1) Tabela: inventário de máquinas e equipamentos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_maquina (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL,
  setor_id                   uuid REFERENCES public.compliance_setores(id) ON DELETE SET NULL,
  tipo                       text NOT NULL DEFAULT 'maquina'
                               CHECK (tipo IN ('maquina','caldeira','vaso_pressao','equip_medicao')),
  nome                       text NOT NULL,
  identificacao              text,                 -- tag / nº de patrimônio / TAG do equipamento
  fabricante                 text,
  modelo                     text,
  nr_aplicavel               text,                 -- ex.: NR-12, NR-13, NR-15
  periodicidade_meses        integer CHECK (periodicidade_meses IS NULL OR periodicidade_meses > 0),
  data_ultima_inspecao       date,
  data_proxima_inspecao      date,
  situacao                   text NOT NULL DEFAULT 'operando'
                               CHECK (situacao IN ('operando','parada','manutencao','interditada')),
  certificado_calibracao     text,                 -- nº/órgão do certificado (equip. de medição)
  data_validade_calibracao   date,
  observacoes                text,
  criado_por                 uuid,
  criado_em                  timestamptz NOT NULL DEFAULT now(),
  atualizado_em              timestamptz NOT NULL DEFAULT now(),
  ativo                      boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ix_compliance_maquina_company ON public.compliance_maquina (company_id, ativo, tipo);
CREATE INDEX IF NOT EXISTS ix_compliance_maquina_setor   ON public.compliance_maquina (setor_id);

ALTER TABLE public.compliance_maquina ENABLE ROW LEVEL SECURITY;
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='compliance_maquina' AND policyname='p_compliance_maquina_tenant') THEN
    CREATE POLICY p_compliance_maquina_tenant ON public.compliance_maquina FOR ALL TO authenticated
      USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
      WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
  END IF;
END $mig$;
REVOKE ALL ON public.compliance_maquina FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_maquina TO authenticated;

-- ------------------------------------------------------------
-- 2) RPCs (SECURITY DEFINER, guarda por empresa via fn_compliance_assert)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ehs_maquina_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'tipo'), (x->>'nome')), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'id', m.id, 'tipo', m.tipo, 'nome', m.nome, 'identificacao', m.identificacao,
      'fabricante', m.fabricante, 'modelo', m.modelo, 'nr_aplicavel', m.nr_aplicavel,
      'setor_id', m.setor_id, 'setor_nome', s.nome,
      'periodicidade_meses', m.periodicidade_meses,
      'data_ultima_inspecao', m.data_ultima_inspecao, 'data_proxima_inspecao', m.data_proxima_inspecao,
      'situacao', m.situacao,
      'certificado_calibracao', m.certificado_calibracao, 'data_validade_calibracao', m.data_validade_calibracao,
      'observacoes', m.observacoes,
      -- alerta: inspeção/calibração vencida ou a vencer em 30 dias
      'inspecao_vencida', (m.data_proxima_inspecao IS NOT NULL AND m.data_proxima_inspecao < CURRENT_DATE),
      'inspecao_a_vencer', (m.data_proxima_inspecao IS NOT NULL AND m.data_proxima_inspecao >= CURRENT_DATE AND m.data_proxima_inspecao <= CURRENT_DATE + 30),
      'calibracao_vencida', (m.data_validade_calibracao IS NOT NULL AND m.data_validade_calibracao < CURRENT_DATE)
    ) AS x
    FROM public.compliance_maquina m
    LEFT JOIN public.compliance_setores s ON s.id = m.setor_id
    WHERE m.company_id = p_company_id AND m.ativo
  ) q;
  RETURN v;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_ehs_maquina_salvar(
  p_company_id uuid, p_id uuid, p_tipo text, p_nome text,
  p_setor_id uuid DEFAULT NULL, p_identificacao text DEFAULT NULL,
  p_fabricante text DEFAULT NULL, p_modelo text DEFAULT NULL, p_nr_aplicavel text DEFAULT NULL,
  p_periodicidade_meses integer DEFAULT NULL,
  p_data_ultima_inspecao date DEFAULT NULL, p_data_proxima_inspecao date DEFAULT NULL,
  p_situacao text DEFAULT 'operando',
  p_certificado_calibracao text DEFAULT NULL, p_data_validade_calibracao date DEFAULT NULL,
  p_observacoes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_id uuid; BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF COALESCE(btrim(p_nome),'') = '' THEN RAISE EXCEPTION 'nome_obrigatorio'; END IF;
  IF COALESCE(p_tipo,'') NOT IN ('maquina','caldeira','vaso_pressao','equip_medicao') THEN
    RAISE EXCEPTION 'tipo_invalido'; END IF;
  IF COALESCE(p_situacao,'operando') NOT IN ('operando','parada','manutencao','interditada') THEN
    RAISE EXCEPTION 'situacao_invalida'; END IF;
  -- setor (se informado) tem de ser da mesma empresa
  IF p_setor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compliance_setores s WHERE s.id = p_setor_id AND s.company_id = p_company_id
  ) THEN RAISE EXCEPTION 'setor_invalido'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.compliance_maquina(
      company_id, setor_id, tipo, nome, identificacao, fabricante, modelo, nr_aplicavel,
      periodicidade_meses, data_ultima_inspecao, data_proxima_inspecao, situacao,
      certificado_calibracao, data_validade_calibracao, observacoes, criado_por)
    VALUES (p_company_id, p_setor_id, p_tipo, btrim(p_nome), NULLIF(btrim(p_identificacao),''),
      NULLIF(btrim(p_fabricante),''), NULLIF(btrim(p_modelo),''), NULLIF(btrim(p_nr_aplicavel),''),
      p_periodicidade_meses, p_data_ultima_inspecao, p_data_proxima_inspecao, COALESCE(p_situacao,'operando'),
      NULLIF(btrim(p_certificado_calibracao),''), p_data_validade_calibracao, NULLIF(btrim(p_observacoes),''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.compliance_maquina SET
      setor_id = p_setor_id, tipo = p_tipo, nome = btrim(p_nome),
      identificacao = NULLIF(btrim(p_identificacao),''), fabricante = NULLIF(btrim(p_fabricante),''),
      modelo = NULLIF(btrim(p_modelo),''), nr_aplicavel = NULLIF(btrim(p_nr_aplicavel),''),
      periodicidade_meses = p_periodicidade_meses, data_ultima_inspecao = p_data_ultima_inspecao,
      data_proxima_inspecao = p_data_proxima_inspecao, situacao = COALESCE(p_situacao,'operando'),
      certificado_calibracao = NULLIF(btrim(p_certificado_calibracao),''),
      data_validade_calibracao = p_data_validade_calibracao, observacoes = NULLIF(btrim(p_observacoes),''),
      atualizado_em = now()
    WHERE id = p_id AND company_id = p_company_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'maquina_invalida'; END IF;
  END IF;
  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_ehs_maquina_inativar(p_company_id uuid, p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  UPDATE public.compliance_maquina SET ativo = false, atualizado_em = now()
   WHERE id = p_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'maquina_invalida'; END IF;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_ehs_maquina_listar(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_ehs_maquina_salvar(uuid,uuid,text,text,uuid,text,text,text,text,integer,date,date,text,text,date,text) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_ehs_maquina_inativar(uuid,uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_ehs_maquina_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_maquina_salvar(uuid,uuid,text,text,uuid,text,text,text,text,integer,date,date,text,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ehs_maquina_inativar(uuid,uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3) Menu (module_catalog) — ao lado de "Setores" no subgrupo docs_regulatorios
-- ------------------------------------------------------------
INSERT INTO public.module_catalog
  (id, nome, rota, grupo, subgrupo, icone, ordem, ativo, is_shared, ehs_modulo,
   so_ps, so_demo, rbac_isento, legacy, diferencial, descricao)
VALUES
  ('ehs_maquinas', 'Máquinas e Equipamentos', '/dashboard/ehs/maquinas', 'compliance',
   'docs_regulatorios', 'Factory', 14, true, true, 'completo',
   false, false, false, false, false,
   'Inventário de máquinas e equipamentos (NR-12), caldeiras e vasos de pressão (NR-13) e equipamentos de medição com certificado de calibração; controle de inspeções e vencimentos.')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 4) system_screens (RD-98 p3) — a tela existe e é auditável
-- ------------------------------------------------------------
INSERT INTO public.system_screens
  (id, area, rota, titulo, estado_real, auditavel_robo, prioridade_monitoramento,
   descricao_funcional, views_consumidas, rpcs_chamadas)
VALUES
  ('dashboard.ehs_maquinas', 'compliance', '/dashboard/ehs/maquinas',
   'Máquinas e Equipamentos', 'pronto', true, 'alta',
   'Inventário NR-12/NR-13 e equipamentos de medição com calibração; inspeções e vencimentos.',
   ARRAY['compliance_maquina','compliance_setores']::text[],
   ARRAY['fn_ehs_maquina_listar','fn_ehs_maquina_salvar','fn_ehs_maquina_inativar','fn_ajuda_campo_listar']::text[])
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 5) Ajuda de campo (RD-95) — "?" em todo campo da tela
-- ------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.maquinas.empresa_alvo', '/dashboard/ehs/maquinas', 'Empresa',
   'Quando você administra um grupo, escolha a empresa cujos equipamentos quer ver e cadastrar.',
   'Garante que o inventário e as inspeções são da empresa certa.',
   'EHS Modelo', 'Cadastrar um equipamento na empresa errada do grupo.',
   'ehs', 0, 1, 'publicado'),
  ('ehs.maquinas.filtro_tipo', '/dashboard/ehs/maquinas', 'Tipo',
   'Escolha o grupo do item: máquina (NR-12), caldeira ou vaso de pressão (NR-13), ou equipamento de medição.',
   'Filtra a lista e muda quais campos importam (ex.: calibração aparece para equipamento de medição).',
   'Caldeira', 'Deixar tudo misturado quando você só quer ver as caldeiras do período de inspeção.',
   'ehs', 1, 1, 'publicado'),
  ('ehs.maquinas.nome', '/dashboard/ehs/maquinas', 'Nome do equipamento',
   'O nome pelo qual a equipe reconhece o equipamento.',
   'Identifica a máquina/equipamento no inventário e nos laudos.',
   'Prensa hidráulica 120t', 'Usar só o código interno, que ninguém reconhece na operação.',
   'ehs', 2, 1, 'publicado'),
  ('ehs.maquinas.identificacao', '/dashboard/ehs/maquinas', 'Identificação (TAG / patrimônio)',
   'A etiqueta, TAG ou número de patrimônio fixado no equipamento.',
   'Liga o cadastro ao bem físico, ao laudo e à ordem de inspeção.',
   'TAG-CLD-01', 'Repetir a mesma TAG em dois equipamentos diferentes.',
   'ehs', 3, 1, 'publicado'),
  ('ehs.maquinas.setor', '/dashboard/ehs/maquinas', 'Setor',
   'O setor onde o equipamento está instalado (opcional).',
   'Permite ver o risco e as inspeções por setor.',
   'Caldeiraria', 'Deixar em branco quando o setor já existe e ajudaria no PGR.',
   'ehs', 4, 1, 'publicado'),
  ('ehs.maquinas.fabricante', '/dashboard/ehs/maquinas', 'Fabricante',
   'Quem fabricou o equipamento.',
   'Consta no prontuário NR-12/NR-13 e ajuda a achar o manual e as peças.',
   'Indústria Metalúrgica', 'Confundir fabricante com fornecedor/revenda.',
   'ehs', 5, 1, 'publicado'),
  ('ehs.maquinas.modelo', '/dashboard/ehs/maquinas', 'Modelo',
   'Modelo ou série do equipamento.',
   'Completa o prontuário e distingue equipamentos parecidos.',
   'VH-120', 'Preencher com o ano em vez do modelo.',
   'ehs', 6, 1, 'publicado'),
  ('ehs.maquinas.nr_aplicavel', '/dashboard/ehs/maquinas', 'NR aplicável',
   'A norma regulamentadora que rege o equipamento.',
   'Deixa claro qual exigência legal de inspeção vale para o item.',
   'NR-13', 'Marcar NR-12 numa caldeira (caldeira é NR-13).',
   'ehs', 7, 1, 'publicado'),
  ('ehs.maquinas.periodicidade', '/dashboard/ehs/maquinas', 'Periodicidade da inspeção (meses)',
   'De quantos em quantos meses o equipamento precisa de inspeção.',
   'O sistema calcula e cobra a próxima inspeção.',
   '12', 'Informar dias em vez de meses.',
   'ehs', 8, 1, 'publicado'),
  ('ehs.maquinas.data_ultima_inspecao', '/dashboard/ehs/maquinas', 'Última inspeção',
   'A data da inspeção mais recente já realizada.',
   'Base para calcular quando vence a próxima.',
   '10/03/2026', 'Colocar a data do laudo antigo quando já houve inspeção mais nova.',
   'ehs', 9, 1, 'publicado'),
  ('ehs.maquinas.data_proxima_inspecao', '/dashboard/ehs/maquinas', 'Próxima inspeção',
   'A data limite da próxima inspeção obrigatória.',
   'Gera o alerta de vencimento (vencida / a vencer em 30 dias).',
   '10/03/2027', 'Deixar em branco quando a NR exige inspeção periódica.',
   'ehs', 10, 1, 'publicado'),
  ('ehs.maquinas.situacao', '/dashboard/ehs/maquinas', 'Situação',
   'O estado atual do equipamento.',
   'Mostra o que está operando, parado, em manutenção ou interditado.',
   'Operando', 'Deixar "Operando" um equipamento interditado por laudo.',
   'ehs', 11, 1, 'publicado'),
  ('ehs.maquinas.certificado_calibracao', '/dashboard/ehs/maquinas', 'Certificado de calibração',
   'O número/órgão do certificado de calibração (equipamentos de medição).',
   'Comprova que o instrumento de medição é confiável para laudos (ex.: dosímetro, decibelímetro).',
   'Cert. 2026/0456', 'Preencher para máquina comum, que não calibra.',
   'ehs', 12, 1, 'publicado'),
  ('ehs.maquinas.data_validade_calibracao', '/dashboard/ehs/maquinas', 'Validade da calibração',
   'Até quando o certificado de calibração é válido.',
   'Alerta quando a calibração vence e o instrumento não pode mais embasar laudo.',
   '30/06/2027', 'Esquecer de atualizar após recalibrar.',
   'ehs', 13, 1, 'publicado'),
  ('ehs.maquinas.observacoes', '/dashboard/ehs/maquinas', 'Observações',
   'Anotações livres sobre o equipamento.',
   'Guarda contexto que não cabe nos outros campos.',
   'Inspeção com apontamento de válvula de segurança.', 'Usar para dado que tem campo próprio (ex.: data).',
   'ehs', 14, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- ------------------------------------------------------------
-- 6) Seed fictício realista — SÓ na DEMO EHS (idempotente por nome+empresa)
-- ------------------------------------------------------------
DO $seed$
DECLARE v_demo uuid := 'b0700000-0000-4000-a000-00000000000b';
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = v_demo) THEN
    INSERT INTO public.compliance_maquina
      (company_id, tipo, nome, identificacao, fabricante, modelo, nr_aplicavel,
       periodicidade_meses, data_ultima_inspecao, data_proxima_inspecao, situacao,
       certificado_calibracao, data_validade_calibracao, observacoes)
    SELECT v_demo, d.tipo, d.nome, d.identificacao, d.fabricante, d.modelo, d.nr_aplicavel,
       d.periodicidade_meses, d.data_ultima_inspecao, d.data_proxima_inspecao, d.situacao,
       d.certificado_calibracao, d.data_validade_calibracao, d.observacoes
    FROM (VALUES
      ('caldeira','Caldeira flamotubular 2 t/h','TAG-CLD-01','Indústria Metalúrgica','FT-2000','NR-13',
       12, DATE '2026-02-15', DATE '2027-02-15','operando', NULL::text, NULL::date,
       'Inspeção interna e externa em dia; válvula de segurança testada.'),
      ('vaso_pressao','Vaso de pressão - reservatório de ar','TAG-VP-07','Compressores Sul','RA-500','NR-13',
       12, DATE '2025-11-20', DATE '2026-11-20','operando', NULL, NULL,
       'Teste hidrostático no último exame periódico.'),
      ('maquina','Prensa hidráulica 120 t','TAG-PRE-03','Máquinas Pesadas','PH-120','NR-12',
       24, DATE '2025-09-10', DATE '2027-09-10','manutencao', NULL, NULL,
       'Em manutenção da cortina de luz (dispositivo de segurança NR-12).'),
      ('maquina','Serra circular de bancada','TAG-SRR-11','Ferramentas Industriais','SC-10','NR-12',
       12, DATE '2026-05-01', DATE '2027-05-01','operando', NULL, NULL,
       'Coifa e cutelo divisor instalados; proteção conforme NR-12.'),
      ('equip_medicao','Dosímetro de ruído','TAG-MED-01','Instrumentos de Medição','DOS-3','NR-15',
       12, NULL, NULL,'operando','Cert. 2026/0456', DATE '2027-06-30',
       'Usado nas avaliações de exposição a ruído (Anexo 1 da NR-15).'),
      ('equip_medicao','Medidor de stress térmico (IBUTG)','TAG-MED-02','Instrumentos de Medição','TGD-200','NR-15',
       12, NULL, NULL,'operando','Cert. 2025/0912', DATE '2026-12-15',
       'Avaliação de calor (Anexo 3 da NR-15); calibração a vencer.')
    ) AS d(tipo,nome,identificacao,fabricante,modelo,nr_aplicavel,periodicidade_meses,
           data_ultima_inspecao,data_proxima_inspecao,situacao,certificado_calibracao,
           data_validade_calibracao,observacoes)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.compliance_maquina m
       WHERE m.company_id = v_demo AND m.nome = d.nome
    );
  END IF;
END $seed$;

-- ------------------------------------------------------------
-- 7) Blueprint vivo: marca os 2 requisitos de M1 como atendidos
-- ------------------------------------------------------------
UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido'
 WHERE vertical = 'ehs' AND tela_num = 1
   AND requisito LIKE 'Máquinas e equipamentos:%';
UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'atendido'
 WHERE vertical = 'ehs' AND tela_num = 1
   AND requisito LIKE 'Equipamentos de medição:%';
