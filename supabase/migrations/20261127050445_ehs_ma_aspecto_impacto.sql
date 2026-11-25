-- PS EHS · M23 Meio Ambiente (EHS-10) — FATIA 1: Aspectos e impactos ambientais (ISO 14001).
-- CEO 21/11/2026: o "E" do EHS entra como M23 (blueprint vertical 'ehs', tela_num=23, rota /dashboard/ehs/meio-ambiente).
-- Requisito atendido (1o essencial): aspectos e impactos por atividade e setor, com SIGNIFICÂNCIA
--   (severidade × frequência × requisito legal) e controle; revisão por gatilho igual ao PGR
--   (mudança, acidente ambiental, nova licença).
--
-- Tabela nova ehs_ma_aspecto_impacto: RLS ligada, SEM policy, REVOKE de anon/authenticated → só pelas RPCs guardadas
--   (padrão do núcleo, ex. prod_posto_custo). Escrita confere a empresa (get_user_company_ids/is_admin) e grava autoria
--   por auth.uid(). Soft-delete rastreável COM MOTIVO (RD-98).
-- Gate: módulo so_demo=true (só empresa DEMO; a Frioeste e demais clientes NÃO veem). Prova na DEMO Indústria …005.
-- Aditiva e idempotente. Não toca dado de cliente, NR-36, outras RLS/policies nem catálogos de outras áreas.
-- RD-100: nenhum nome de sistema de terceiros. Faixa de segundos :45 (desenvolvedor_5_g).
-- Code: desenvolvedor_5_g

-- 1) Tabela dos aspectos/impactos ambientais (sem acesso direto; só RPC)
CREATE TABLE IF NOT EXISTS public.ehs_ma_aspecto_impacto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  plant_id uuid,                              -- unidade/planta (industrial_plants), opcional
  setor_id uuid,                              -- compliance_setores, opcional
  atividade text NOT NULL,                    -- atividade/processo que gera o aspecto
  aspecto text NOT NULL,                      -- aspecto ambiental (o que a atividade causa no meio)
  impacto text NOT NULL,                      -- impacto ambiental resultante
  condicao text NOT NULL DEFAULT 'normal' CHECK (condicao IN ('normal','anormal','emergencia')),
  severidade smallint NOT NULL CHECK (severidade BETWEEN 1 AND 5),
  frequencia smallint NOT NULL CHECK (frequencia BETWEEN 1 AND 5),
  requisito_legal boolean NOT NULL DEFAULT false,   -- há requisito legal associado?
  -- Significância = severidade × frequência, dobrada quando há requisito legal (ISO 14001, peso do legal)
  significancia smallint GENERATED ALWAYS AS (
    (severidade::int * frequencia::int * (CASE WHEN requisito_legal THEN 2 ELSE 1 END))
  ) STORED,
  -- Significativo quando a significância atinge o limiar OU existe requisito legal
  significativo boolean GENERATED ALWAYS AS (
    requisito_legal OR (severidade::int * frequencia::int) >= 12
  ) STORED,
  controle text,                              -- medidas de controle existentes
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','em_revisao','encerrado')),
  revisao_gatilho text CHECK (revisao_gatilho IS NULL OR revisao_gatilho IN ('mudanca','acidente_ambiental','nova_licenca','periodica')),
  revisao_motivo text,
  proxima_revisao date,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  updated_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_motivo text
);
CREATE INDEX IF NOT EXISTS ix_ehs_ma_aspecto_company ON public.ehs_ma_aspecto_impacto(company_id, situacao) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ehs_ma_aspecto_setor ON public.ehs_ma_aspecto_impacto(setor_id) WHERE deleted_at IS NULL;
ALTER TABLE public.ehs_ma_aspecto_impacto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ehs_ma_aspecto_impacto FROM anon, authenticated;

-- 2) Listar os aspectos/impactos da empresa (SECURITY DEFINER guardada)
CREATE OR REPLACE FUNCTION public.fn_ehs_ma_aspecto_listar(p_company_id uuid, p_incluir_excluidos boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'significancia')::int DESC, x->>'atividade'), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object(
      'id', a.id, 'atividade', a.atividade, 'aspecto', a.aspecto, 'impacto', a.impacto,
      'condicao', a.condicao, 'severidade', a.severidade, 'frequencia', a.frequencia,
      'requisito_legal', a.requisito_legal, 'significancia', a.significancia, 'significativo', a.significativo,
      'controle', a.controle, 'situacao', a.situacao, 'setor_id', a.setor_id, 'setor_nome', s.nome,
      'revisao_gatilho', a.revisao_gatilho, 'revisao_motivo', a.revisao_motivo, 'proxima_revisao', a.proxima_revisao,
      'excluido', (a.deleted_at IS NOT NULL)
    ) AS x
    FROM ehs_ma_aspecto_impacto a
    LEFT JOIN compliance_setores s ON s.id = a.setor_id
    WHERE a.company_id = p_company_id
      AND (p_incluir_excluidos OR a.deleted_at IS NULL)
  ) t;
  RETURN jsonb_build_object('ok', true, 'itens', v);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ehs_ma_aspecto_listar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_ma_aspecto_listar(uuid, boolean) TO authenticated;

-- 3) Salvar (criar ou editar) um aspecto/impacto
CREATE OR REPLACE FUNCTION public.fn_ehs_ma_aspecto_salvar(p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id','')::uuid;
  v_comp uuid := NULLIF(p_dados->>'company_id','')::uuid;
  v_setor uuid := NULLIF(p_dados->>'setor_id','')::uuid;
  v_sev smallint := NULLIF(p_dados->>'severidade','')::smallint;
  v_freq smallint := NULLIF(p_dados->>'frequencia','')::smallint;
  v_atv text := NULLIF(btrim(coalesce(p_dados->>'atividade','')),'');
  v_asp text := NULLIF(btrim(coalesce(p_dados->>'aspecto','')),'');
  v_imp text := NULLIF(btrim(coalesce(p_dados->>'impacto','')),'');
  v_cond text := coalesce(NULLIF(p_dados->>'condicao',''),'normal');
  v_situ text := coalesce(NULLIF(p_dados->>'situacao',''),'ativo');
  v_result uuid;
BEGIN
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_obrigatoria'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_atv IS NULL OR v_asp IS NULL OR v_imp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'atividade_aspecto_impacto_obrigatorios'); END IF;
  IF v_sev IS NULL OR v_sev < 1 OR v_sev > 5 OR v_freq IS NULL OR v_freq < 1 OR v_freq > 5 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'severidade_frequencia_de_1_a_5'); END IF;
  IF v_cond NOT IN ('normal','anormal','emergencia') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'condicao_invalida'); END IF;
  IF v_setor IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM compliance_setores s WHERE s.id = v_setor AND (s.is_global OR s.company_id = v_comp)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'setor_de_outra_empresa'); END IF;

  IF v_id IS NULL THEN
    INSERT INTO ehs_ma_aspecto_impacto
      (company_id, plant_id, setor_id, atividade, aspecto, impacto, condicao, severidade, frequencia,
       requisito_legal, controle, situacao, revisao_gatilho, revisao_motivo, proxima_revisao, criado_por)
    VALUES
      (v_comp, NULLIF(p_dados->>'plant_id','')::uuid, v_setor, v_atv, v_asp, v_imp, v_cond, v_sev, v_freq,
       coalesce((p_dados->>'requisito_legal')::boolean, false), NULLIF(btrim(coalesce(p_dados->>'controle','')),''),
       v_situ, NULLIF(p_dados->>'revisao_gatilho',''), NULLIF(btrim(coalesce(p_dados->>'revisao_motivo','')),''),
       NULLIF(p_dados->>'proxima_revisao','')::date, auth.uid())
    RETURNING id INTO v_result;
  ELSE
    UPDATE ehs_ma_aspecto_impacto SET
      setor_id = v_setor, atividade = v_atv, aspecto = v_asp, impacto = v_imp, condicao = v_cond,
      severidade = v_sev, frequencia = v_freq,
      requisito_legal = coalesce((p_dados->>'requisito_legal')::boolean, requisito_legal),
      controle = NULLIF(btrim(coalesce(p_dados->>'controle','')),''), situacao = v_situ,
      revisao_gatilho = NULLIF(p_dados->>'revisao_gatilho',''),
      revisao_motivo = NULLIF(btrim(coalesce(p_dados->>'revisao_motivo','')),''),
      proxima_revisao = NULLIF(p_dados->>'proxima_revisao','')::date,
      atualizado_por = auth.uid(), updated_at = now()
    WHERE id = v_id AND company_id = v_comp AND deleted_at IS NULL
    RETURNING id INTO v_result;
    IF v_result IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'registro_nao_encontrado'); END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_result);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ehs_ma_aspecto_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_ma_aspecto_salvar(jsonb) TO authenticated;

-- 4) Excluir (soft-delete) rastreável COM MOTIVO (RD-98)
CREATE OR REPLACE FUNCTION public.fn_ehs_ma_aspecto_excluir(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_comp uuid; v_mot text := NULLIF(btrim(coalesce(p_motivo,'')),'');
BEGIN
  SELECT company_id INTO v_comp FROM ehs_ma_aspecto_impacto WHERE id = p_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'registro_nao_encontrado'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_mot IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio'); END IF;
  UPDATE ehs_ma_aspecto_impacto
     SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = v_mot, situacao = 'encerrado'
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ehs_ma_aspecto_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_ma_aspecto_excluir(uuid, text) TO authenticated;

-- 5) Menu (só DEMO): seção Meio ambiente + item da tela
INSERT INTO public.module_subgrupos (id, label, grupo, ordem, ativo, descricao)
VALUES ('ehs_meio_ambiente', 'EHS · Meio ambiente', 'compliance', 8, true, 'PS EHS · M23 (o "E" do EHS)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, descricao, is_shared, legacy, subgrupo, surface_in_groups, so_demo, so_ps, diferencial)
VALUES
  ('ehs_meio_ambiente', 'M23 · Meio ambiente', 'compliance', 'Leaf', '/dashboard/ehs/meio-ambiente', 1, true,
   'Aspectos e impactos ambientais, licenças, resíduos e monitoramentos (ISO 14001) — o "E" do EHS', false, false,
   'ehs_meio_ambiente', ARRAY[]::text[], true, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.area_secao_ordem (area_slug, secao, ordem, ativo)
SELECT 'compliance', 'EHS_MEIO_AMBIENTE', 8, true
WHERE NOT EXISTS (SELECT 1 FROM public.area_secao_ordem a WHERE a.area_slug = 'compliance' AND a.secao = 'EHS_MEIO_AMBIENTE');

INSERT INTO public.plan_modules (id, plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT gen_random_uuid(), 'v15_compliance', 'ehs_meio_ambiente', true, NULL, false
WHERE EXISTS (SELECT 1 FROM public.plan_catalog pc WHERE pc.id = 'v15_compliance')
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id = 'v15_compliance' AND pm.module_id = 'ehs_meio_ambiente');

-- 6) Tela em system_screens (entrega só conta se o usuário a enxerga)
INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, auditavel_robo, motivo_nao_auditavel)
VALUES
  ('S.ehs.meio_ambiente', '/dashboard/ehs/meio-ambiente', 'compliance', 'PS EHS · Meio ambiente',
   'M23 (o "E" do EHS): levantamento de aspectos e impactos ambientais por atividade e setor, com significância (severidade × frequência × requisito legal), controle e revisão por gatilho (mudança, acidente ambiental, nova licença).',
   'ehs_meio_ambiente', 'parcial', 'media', false,
   'Fatia 1 de M23 (só aspectos e impactos); licenças, resíduos e monitoramentos entram nas fatias seguintes.')
ON CONFLICT (id) DO UPDATE SET descricao_funcional = EXCLUDED.descricao_funcional, estado_real = EXCLUDED.estado_real;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.meio_ambiente.aspectos', 'ehs_meio_ambiente', 'compliance', 'Aspectos e impactos ambientais',
        'parcial', 20, 'alta',
        'Levantamento de aspectos e impactos ambientais com significância e controle (ISO 14001), base do M23 Meio Ambiente.',
        'ehs_ma_aspecto_impacto + fn_ehs_ma_aspecto_listar/salvar/excluir; tela /dashboard/ehs/meio-ambiente')
ON CONFLICT (id) DO NOTHING;

-- 7) "?" de ajuda (RD-95) — um por campo/ação da tela
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('ehs.meio_ambiente.novo', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Novo aspecto/impacto',
   'Clique para cadastrar uma atividade e o aspecto/impacto ambiental que ela gera.',
   'Monta o levantamento de aspectos e impactos (ISO 14001) que é a base da gestão ambiental e do licenciamento.',
   'Atividade "Abate — sangria" → aspecto "Geração de efluente orgânico" → impacto "Carga poluidora no corpo d''água".',
   'Deixar de registrar aspectos de condição anormal ou de emergência (vazamento, falha): eles também contam.',
   'compliance', 1, 'publicado'),
  ('ehs.meio_ambiente.atividade', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Atividade',
   'A atividade ou processo que causa o aspecto ambiental.',
   'Liga o aspecto ao processo real; ajuda a priorizar onde agir e a montar a licença por unidade.',
   'Abate — sangria; Lavagem de pisos; Caldeira; Estação de tratamento de efluente.',
   'Escrever o impacto no lugar da atividade: aqui vai o que a empresa faz, não a consequência.',
   'compliance', 2, 'publicado'),
  ('ehs.meio_ambiente.aspecto', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Aspecto ambiental',
   'O que a atividade gera e que interage com o meio ambiente (emissão, efluente, resíduo, consumo).',
   'É o "aspecto" da ISO 14001 — a causa ambiental; cada aspecto tem um impacto associado.',
   'Geração de efluente orgânico; Emissão de odor; Consumo de água; Geração de resíduo Classe I.',
   'Confundir aspecto (o que sai do processo) com impacto (o efeito no meio).',
   'compliance', 3, 'publicado'),
  ('ehs.meio_ambiente.impacto', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Impacto ambiental',
   'A alteração no meio ambiente causada pelo aspecto (o efeito).',
   'É o "impacto" da ISO 14001; orienta os controles e os monitoramentos exigidos.',
   'Contaminação de corpo d''água; Incômodo à vizinhança; Esgotamento de recurso hídrico.',
   'Repetir o aspecto como impacto: o impacto é a consequência no meio, não a emissão em si.',
   'compliance', 4, 'publicado'),
  ('ehs.meio_ambiente.condicao', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Condição',
   'Em que situação o aspecto ocorre: normal (rotina), anormal (partida/parada) ou emergência (acidente/vazamento).',
   'A ISO 14001 exige avaliar as três condições; emergências costumam ter significância maior.',
   'Vazamento de amônia da câmara fria = emergência; efluente do abate diário = normal.',
   'Registrar só a condição normal e esquecer as de emergência, que são as de maior risco.',
   'compliance', 5, 'publicado'),
  ('ehs.meio_ambiente.severidade', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Severidade (1–5)',
   'O tamanho do dano ao meio ambiente se o impacto acontecer, de 1 (leve) a 5 (grave).',
   'Entra na significância (severidade × frequência); junto com a frequência decide a prioridade.',
   'Contaminação de rio = 5; leve consumo de água = 2.',
   'Usar sempre o valor máximo: calibre pela realidade, senão tudo vira prioridade.',
   'compliance', 6, 'publicado'),
  ('ehs.meio_ambiente.frequencia', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Frequência (1–5)',
   'Com que frequência o aspecto ocorre, de 1 (raro) a 5 (contínuo).',
   'Entra na significância (severidade × frequência); um impacto grave e contínuo é o mais crítico.',
   'Efluente gerado todo dia = 5; vazamento raro = 1.',
   'Confundir com severidade: aqui é quantas vezes acontece, não o tamanho do dano.',
   'compliance', 7, 'publicado'),
  ('ehs.meio_ambiente.requisito_legal', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Tem requisito legal?',
   'Marque se há lei, licença ou condicionante que trata desse aspecto.',
   'Aspecto com requisito legal é sempre significativo e dobra o peso da significância.',
   'Lançamento de efluente (tem padrão do CONAMA) = sim; consumo de papel no escritório = não.',
   'Deixar desmarcado quando existe condicionante da licença — ele precisa virar significativo.',
   'compliance', 8, 'publicado'),
  ('ehs.meio_ambiente.significancia', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Significância',
   'Não preenche: é calculada (severidade × frequência, dobrada se houver requisito legal).',
   'Ordena o levantamento por prioridade; os significativos exigem controle e monitoramento.',
   'Severidade 5 × frequência 4 = 20; com requisito legal = 40.',
   'Tentar editar o número: ele vem do cálculo, mude a severidade/frequência.',
   'compliance', 9, 'publicado'),
  ('ehs.meio_ambiente.controle', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Controle existente',
   'As medidas que já controlam esse impacto hoje (tratamento, contenção, procedimento).',
   'Mostra o que já existe e onde falta controle; aspecto significativo sem controle é lacuna.',
   'Estação de tratamento de efluente; bacia de contenção; coleta seletiva.',
   'Escrever "nenhum" e deixar sem plano: aspecto significativo sem controle precisa de ação.',
   'compliance', 10, 'publicado'),
  ('ehs.meio_ambiente.setor', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Setor',
   'O setor da empresa onde a atividade acontece (opcional).',
   'Liga o aspecto ao setor para cruzar com o PGR e organizar as ações por área.',
   'Abate; Graxaria; Utilidades; Estação de efluente.',
   'Deixar em branco quando o setor é conhecido: dificulta a priorização por área.',
   'compliance', 11, 'publicado'),
  ('ehs.meio_ambiente.revisao', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Revisão por gatilho',
   'O motivo e a próxima data de revisão quando algo muda (mudança de processo, acidente ambiental, nova licença).',
   'Igual ao PGR: o levantamento é revisto por gatilho, não só por calendário.',
   'Nova licença de operação → revisar aspectos ligados às condicionantes.',
   'Nunca revisar depois de um acidente ambiental ou de uma mudança no processo.',
   'compliance', 12, 'publicado'),
  ('ehs.meio_ambiente.editar', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Editar',
   'Abre o aspecto para ajustar atividade, severidade, controle ou situação.',
   'Mantém o levantamento vivo conforme o processo muda.',
   'Reduzir a frequência depois de instalar um controle que diminui a geração.',
   'Editar sem registrar o gatilho da revisão quando a mudança foi relevante.',
   'compliance', 13, 'publicado'),
  ('ehs.meio_ambiente.excluir', '/dashboard/ehs/meio-ambiente', 'Meio ambiente', 'Excluir',
   'Remove o aspecto do levantamento; exige um motivo e fica rastreável (quem e por quê).',
   'Nada some de verdade: o registro é encerrado com motivo, para auditoria.',
   'Atividade desativada na planta → excluir com motivo "processo encerrado".',
   'Excluir sem motivo claro: o motivo é obrigatório e fica no histórico.',
   'compliance', 14, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 8) Seed de demonstração — SÓ na DEMO Indústria Modelo (…005), idempotente (nunca dado de cliente)
INSERT INTO public.ehs_ma_aspecto_impacto
  (company_id, atividade, aspecto, impacto, condicao, severidade, frequencia, requisito_legal, controle, situacao, setor_id)
SELECT d.company_id, d.atividade, d.aspecto, d.impacto, d.condicao, d.severidade, d.frequencia, d.requisito_legal, d.controle, 'ativo',
       (SELECT s.id FROM public.compliance_setores s
         WHERE (s.company_id = d.company_id OR s.is_global) AND lower(s.nome) = lower(d.setor_nome)
         ORDER BY (s.company_id = d.company_id) DESC LIMIT 1)
FROM (VALUES
  ('b0700000-0000-4000-a000-000000000005'::uuid, 'Abate e processamento — linha', 'Geração de efluente orgânico',
   'Carga poluidora em corpo d''água receptor', 'normal', 5::smallint, 5::smallint, true,
   'Estação de tratamento de efluente (ETE) com monitoramento mensal', 'Abate'),
  ('b0700000-0000-4000-a000-000000000005'::uuid, 'Graxaria — cozimento', 'Emissão de odor',
   'Incômodo à vizinhança', 'normal', 3::smallint, 4::smallint, true,
   'Lavador de gases (scrubber) e manutenção preventiva', 'Graxaria'),
  ('b0700000-0000-4000-a000-000000000005'::uuid, 'Câmaras frias — refrigeração', 'Vazamento de amônia (NH₃)',
   'Contaminação do ar e risco ambiental na vizinhança', 'emergencia', 5::smallint, 1::smallint, true,
   'Plano de atendimento a emergência, detectores e bacia de contenção', 'Utilidades'),
  ('b0700000-0000-4000-a000-000000000005'::uuid, 'Limpeza e higienização (CIP)', 'Consumo de água',
   'Esgotamento de recurso hídrico', 'normal', 2::smallint, 5::smallint, false,
   'Reuso de água e medição por ponto de consumo', 'Utilidades')
) AS d(company_id, atividade, aspecto, impacto, condicao, severidade, frequencia, requisito_legal, controle, setor_nome)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = d.company_id AND c.is_demo = true)
  AND NOT EXISTS (
    SELECT 1 FROM public.ehs_ma_aspecto_impacto a
     WHERE a.company_id = d.company_id AND a.atividade = d.atividade AND a.aspecto = d.aspecto);

-- 9) Blueprint vivo: marca o requisito de aspectos/impactos como atendido por esta fatia (CEO 21/11 · tela 22)
UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'parcial',
       evidencia_baseline = 'M23 fatia 1 · /dashboard/ehs/meio-ambiente · ehs_ma_aspecto_impacto (aspectos, impactos, significância, revisão por gatilho)'
 WHERE vertical = 'ehs' AND tela_num = 23
   AND requisito LIKE 'Aspectos e impactos ambientais por atividade e setor%'
   AND status_baseline = 'ausente';
