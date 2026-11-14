-- Hub · Gestão de Obras · Encerramento (H8 · HBF-7.2) — Retenção contratual e garantia da obra.
-- Terceira aba da tela /dashboard/projetos/obras/[id]/encerramento (as abas Termo de entrega #3933 e
-- Documentos #3912 já estão na main). Registra, por obra:
--   • RETENÇÃO contratual: percentual/valor retido e a data prevista de liberação, com situação própria
--     (prevista | liberada | cancelada). É o CONTROLE da retenção — o acompanhamento de quanto ficou retido
--     e quando deve ser devolvido.
--   • GARANTIA: prazo contratual (meses), início/fim e situação (vigente | encerrada | acionada).
--
-- FRONTEIRA DE NÚCLEO (importante): esta fatia NÃO cria nem altera título financeiro. "Retenção vira título
-- futuro em erp_receber" é mudança no FINANCEIRO (núcleo, gilberto-desenv) e entra numa PR própria, coordenada,
-- consumindo este controle como origem. Aqui só existe o REGISTRO/ACOMPANHAMENTO da retenção e da garantia,
-- escopado à obra. Não toca projetos_obras, erp_receber, erp_pagar nem qualquer tabela de núcleo.
--
-- ADITIVA: tabela NOVA (um registro por obra, UNIQUE obra_id), RLS por empresa, REVOKE anon, SEM DELETE.
-- Mesma construção de erp_obra_termo_entrega (RD-52: reuso de padrão). RD-38: colunas de projetos_obras /
-- audit_log_global e as guardas get_user_company_ids()/is_admin()/fn__guarda_empresa(uuid) conferidas no dado;
-- jornada (upsert, isolamento por empresa=0, auditoria) provada em BEGIN…ROLLBACK (statement_timeout 15s),
-- nada gravado em produção. RD-100: sem nome de terceiros.

-- ───────────────────────────── 1) Tabela ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_obra_retencao_garantia (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  obra_id         uuid NOT NULL,
  -- Retenção contratual
  retencao_percentual               numeric,
  retencao_valor                    numeric,
  retencao_data_prevista_liberacao  date,
  retencao_status                   text NOT NULL DEFAULT 'prevista',  -- prevista | liberada | cancelada
  retencao_observacoes              text,
  -- Garantia
  garantia_prazo_meses   integer,
  garantia_inicio        date,
  garantia_fim           date,
  garantia_status        text NOT NULL DEFAULT 'vigente',  -- vigente | encerrada | acionada
  garantia_observacoes   text,
  -- auditoria da linha
  criado_por     uuid DEFAULT auth.uid(),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_obra_retencao_garantia_obra_uniq UNIQUE (obra_id),
  CONSTRAINT erp_obra_retencao_garantia_ret_status_chk CHECK (retencao_status IN ('prevista','liberada','cancelada')),
  CONSTRAINT erp_obra_retencao_garantia_gar_status_chk CHECK (garantia_status IN ('vigente','encerrada','acionada')),
  CONSTRAINT erp_obra_retencao_garantia_pct_chk CHECK (retencao_percentual IS NULL OR (retencao_percentual >= 0 AND retencao_percentual <= 100)),
  CONSTRAINT erp_obra_retencao_garantia_valor_chk CHECK (retencao_valor IS NULL OR retencao_valor >= 0),
  CONSTRAINT erp_obra_retencao_garantia_prazo_chk CHECK (garantia_prazo_meses IS NULL OR garantia_prazo_meses >= 0)
);

COMMENT ON TABLE public.erp_obra_retencao_garantia IS
  'Controle de retenção contratual e garantia da obra (Hub Gestão de Obras · Encerramento). Um registro por obra. NÃO cria título financeiro (fronteira de núcleo/erp_receber) — só registro/acompanhamento.';

CREATE INDEX IF NOT EXISTS idx_obra_retencao_garantia_obra
  ON public.erp_obra_retencao_garantia (company_id, obra_id);

ALTER TABLE public.erp_obra_retencao_garantia ENABLE ROW LEVEL SECURITY;

-- RLS fail-closed: só membros da empresa (ou admin). Sem policy de DELETE (o registro não se apaga).
DROP POLICY IF EXISTS obra_retencao_garantia_sel ON public.erp_obra_retencao_garantia;
DROP POLICY IF EXISTS obra_retencao_garantia_ins ON public.erp_obra_retencao_garantia;
DROP POLICY IF EXISTS obra_retencao_garantia_upd ON public.erp_obra_retencao_garantia;
CREATE POLICY obra_retencao_garantia_sel ON public.erp_obra_retencao_garantia FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY obra_retencao_garantia_ins ON public.erp_obra_retencao_garantia FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());
CREATE POLICY obra_retencao_garantia_upd ON public.erp_obra_retencao_garantia FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

REVOKE ALL ON public.erp_obra_retencao_garantia FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.erp_obra_retencao_garantia TO authenticated;

-- ───────────────────────────── 2) RPCs ─────────────────────────────
-- Leitura do controle da obra (escopado por empresa do usuário / admin).
CREATE OR REPLACE FUNCTION public.fn_obra_retencao_garantia_obter(p_obra_id uuid)
RETURNS TABLE(
  id uuid, obra_id uuid,
  retencao_percentual numeric, retencao_valor numeric,
  retencao_data_prevista_liberacao date, retencao_status text, retencao_observacoes text,
  garantia_prazo_meses integer, garantia_inicio date, garantia_fim date,
  garantia_status text, garantia_observacoes text,
  criado_por uuid, criado_em timestamptz, atualizado_por uuid, atualizado_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT r.id, r.obra_id,
         r.retencao_percentual, r.retencao_valor,
         r.retencao_data_prevista_liberacao, r.retencao_status, r.retencao_observacoes,
         r.garantia_prazo_meses, r.garantia_inicio, r.garantia_fim,
         r.garantia_status, r.garantia_observacoes,
         r.criado_por, r.criado_em, r.atualizado_por, r.atualizado_em
  FROM erp_obra_retencao_garantia r
  JOIN projetos_obras o ON o.id = r.obra_id
  WHERE r.obra_id = p_obra_id
    AND (o.company_id IN (SELECT get_user_company_ids()) OR is_admin());
$fn$;

-- Registra/atualiza o controle de retenção e garantia de UMA obra (UNIQUE(obra_id) → upsert).
CREATE OR REPLACE FUNCTION public.fn_obra_retencao_garantia_salvar(
  p_obra_id uuid,
  p_retencao_percentual numeric DEFAULT NULL,
  p_retencao_valor numeric DEFAULT NULL,
  p_retencao_data_prevista_liberacao date DEFAULT NULL,
  p_retencao_status text DEFAULT 'prevista',
  p_retencao_observacoes text DEFAULT NULL,
  p_garantia_prazo_meses integer DEFAULT NULL,
  p_garantia_inicio date DEFAULT NULL,
  p_garantia_fim date DEFAULT NULL,
  p_garantia_status text DEFAULT 'vigente',
  p_garantia_observacoes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_company uuid;
  v_id uuid;
  v_antes jsonb;
  v_ret_status text := COALESCE(NULLIF(trim(p_retencao_status), ''), 'prevista');
  v_gar_status text := COALESCE(NULLIF(trim(p_garantia_status), ''), 'vigente');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF p_obra_id IS NULL THEN RAISE EXCEPTION 'Obra obrigatória'; END IF;
  IF v_ret_status NOT IN ('prevista','liberada','cancelada') THEN
    RAISE EXCEPTION 'Situação da retenção inválida';
  END IF;
  IF v_gar_status NOT IN ('vigente','encerrada','acionada') THEN
    RAISE EXCEPTION 'Situação da garantia inválida';
  END IF;
  IF p_retencao_percentual IS NOT NULL AND (p_retencao_percentual < 0 OR p_retencao_percentual > 100) THEN
    RAISE EXCEPTION 'Percentual de retenção deve estar entre 0 e 100';
  END IF;

  SELECT company_id INTO v_company
    FROM projetos_obras
   WHERE id = p_obra_id AND deleted_at IS NULL
   FOR UPDATE;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM fn__guarda_empresa(v_company);  -- defesa em profundidade (RLS também cobre)

  SELECT r.id, to_jsonb(r) INTO v_id, v_antes
    FROM erp_obra_retencao_garantia r WHERE r.obra_id = p_obra_id;

  IF v_id IS NULL THEN
    INSERT INTO erp_obra_retencao_garantia(
      company_id, obra_id,
      retencao_percentual, retencao_valor, retencao_data_prevista_liberacao, retencao_status, retencao_observacoes,
      garantia_prazo_meses, garantia_inicio, garantia_fim, garantia_status, garantia_observacoes,
      criado_por, criado_em, atualizado_por, atualizado_em)
    VALUES(
      v_company, p_obra_id,
      p_retencao_percentual, p_retencao_valor, p_retencao_data_prevista_liberacao, v_ret_status, p_retencao_observacoes,
      p_garantia_prazo_meses, p_garantia_inicio, p_garantia_fim, v_gar_status, p_garantia_observacoes,
      v_uid, now(), v_uid, now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_obra_retencao_garantia SET
      retencao_percentual              = p_retencao_percentual,
      retencao_valor                   = p_retencao_valor,
      retencao_data_prevista_liberacao = p_retencao_data_prevista_liberacao,
      retencao_status                  = v_ret_status,
      retencao_observacoes             = p_retencao_observacoes,
      garantia_prazo_meses             = p_garantia_prazo_meses,
      garantia_inicio                  = p_garantia_inicio,
      garantia_fim                     = p_garantia_fim,
      garantia_status                  = v_gar_status,
      garantia_observacoes             = p_garantia_observacoes,
      atualizado_por                   = v_uid,
      atualizado_em                    = now()
    WHERE id = v_id;
  END IF;

  INSERT INTO audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo, created_at)
  VALUES(
    v_company, v_uid, 'erp_obra_retencao_garantia', v_id::text,
    CASE WHEN v_antes IS NULL THEN 'criar' ELSE 'atualizar' END,
    v_antes,
    jsonb_build_object(
      'obra_id', p_obra_id,
      'retencao_status', v_ret_status, 'retencao_percentual', p_retencao_percentual, 'retencao_valor', p_retencao_valor,
      'garantia_status', v_gar_status, 'garantia_prazo_meses', p_garantia_prazo_meses),
    now());

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_obra_retencao_garantia_obter(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_retencao_garantia_salvar(uuid, numeric, numeric, date, text, text, integer, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_retencao_garantia_obter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_retencao_garantia_salvar(uuid, numeric, numeric, date, text, text, integer, date, date, text, text) TO authenticated, service_role;

-- ───────────────────────────── 3) Ajuda "?" (RD-95) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/obras/[id]/encerramento', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.encerramento.retencao_garantia', 'Retenção e garantia', 'Retenção e garantia',
  'Controle da retenção contratual (parte do valor que fica retida até o fim) e da garantia da obra. Preencha quando a obra estiver encerrando.',
  'Acompanha quanto ficou retido e quando deve ser liberado, e por quanto tempo a obra está na garantia — sem deixar isso solto em planilha.',
  'Retenção de 5% (R$ 2.160,76) prevista para liberar em 10/04/2027; garantia de 12 meses a partir da entrega.',
  'Confundir a retenção (valor que volta ao cliente/empreiteiro) com o custo da obra: aqui é só o controle do que ficou retido.',
  70),
 ('projetos.encerramento.retencao_percentual', 'Retenção e garantia', 'Percentual de retenção',
  'O percentual do contrato (ou da medição) que fica retido como garantia de execução. Entre 0 e 100. Opcional.',
  'Deixa claro quanto do valor foi retido, em percentual — base para conferir o valor retido.',
  '5 (para 5%).',
  'Digitar o valor em reais no lugar do percentual. Aqui é só o percentual (0 a 100).',
  71),
 ('projetos.encerramento.retencao_valor', 'Retenção e garantia', 'Valor retido (R$)',
  'O valor em reais que está retido. Opcional — pode preencher só o percentual, só o valor, ou os dois.',
  'Mostra em dinheiro quanto está retido, para acompanhar a devolução no fim da obra.',
  '2160,76.',
  'Somar aqui valores já liberados: este campo é o que AINDA está retido.',
  72),
 ('projetos.encerramento.retencao_liberacao', 'Retenção e garantia', 'Data prevista de liberação',
  'A data em que a retenção deve ser liberada (devolvida), conforme o contrato. Opcional.',
  'Serve de lembrete do compromisso de devolver a retenção — e vai alimentar o título financeiro quando essa etapa for ligada.',
  '10/04/2027.',
  'Deixar sem data quando o contrato prevê um prazo: sem data, ninguém é lembrado de liberar.',
  73),
 ('projetos.encerramento.retencao_status', 'Retenção e garantia', 'Situação da retenção',
  'Em que pé está a retenção: Prevista (ainda retida), Liberada (já devolvida) ou Cancelada (não se aplica).',
  'Controla o ciclo da retenção sem depender de planilha paralela.',
  'Prevista até a liberação; depois, Liberada.',
  'Marcar como Liberada antes de a devolução realmente acontecer.',
  74),
 ('projetos.encerramento.retencao_obs', 'Retenção e garantia', 'Observações da retenção',
  'Texto livre com condições da retenção: sobre o que incide, como será devolvida, combinados. Opcional.',
  'Deixa registrado, junto da obra, o acordo da retenção — evita discussão depois.',
  '"Retenção de 5% sobre as medições, a devolver 90 dias após a entrega."',
  'Guardar o combinado só em mensagem: aqui ele fica anexado à obra.',
  75),
 ('projetos.encerramento.garantia_prazo', 'Retenção e garantia', 'Prazo de garantia (meses)',
  'Por quantos meses a obra fica em garantia, conforme o contrato. Opcional.',
  'Define a janela de garantia — base para calcular o fim e para avisar antes de encerrar.',
  '12 (para 12 meses) ou 60 (garantia quinquenal da estrutura).',
  'Confundir meses com anos: o campo é em MESES (5 anos = 60).',
  76),
 ('projetos.encerramento.garantia_inicio', 'Retenção e garantia', 'Início da garantia',
  'A data em que começa a contar a garantia — normalmente a data de entrega da obra. Opcional.',
  'Marca o começo da garantia, para calcular o fim junto com o prazo.',
  '10/10/2026 (dia da entrega).',
  'Usar a data de início da obra em vez da data de entrega.',
  77),
 ('projetos.encerramento.garantia_fim', 'Retenção e garantia', 'Fim da garantia',
  'A data em que a garantia termina. Pode calcular a partir do início + prazo, ou informar a data combinada. Opcional.',
  'Deixa visível até quando a obra está coberta — útil para o cliente e para a equipe.',
  '10/10/2027 (um ano após a entrega).',
  'Deixar uma data de fim anterior ao início da garantia.',
  78),
 ('projetos.encerramento.garantia_status', 'Retenção e garantia', 'Situação da garantia',
  'Em que pé está a garantia: Vigente (dentro do prazo), Encerrada (prazo acabou) ou Acionada (houve chamado de garantia).',
  'Mostra de relance se a obra ainda está coberta e se a garantia foi usada.',
  'Vigente durante o prazo; Encerrada depois do fim.',
  'Deixar como Vigente uma garantia cujo prazo já passou.',
  79),
 ('projetos.encerramento.garantia_obs', 'Retenção e garantia', 'Observações da garantia',
  'Texto livre com o escopo da garantia: o que cobre, exclusões, condições. Opcional.',
  'Registra junto da obra o que a garantia cobre — base para responder um acionamento.',
  '"Garantia de 12 meses para instalações; 5 anos para a estrutura (NBR)."',
  'Prometer cobertura na conversa e não registrar aqui: no acionamento, vale o que está escrito.',
  80),
 ('projetos.encerramento.retencao_garantia_salvar', 'Retenção e garantia', 'Salvar retenção e garantia',
  'Grava o controle de retenção e garantia da obra. Pode editar e salvar quantas vezes precisar.',
  'Guarda as informações de retenção e garantia para a obra, com registro de quem salvou e quando.',
  'Depois de preencher o percentual, o valor e o prazo de garantia, clicar em "Salvar".',
  'Sair da tela sem salvar: o que foi digitado só é guardado ao clicar em Salvar.',
  81)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;

-- ───────────────────────────── 4) Seed DEMO (idempotente, só empresa DEMO) ─────────────────────────────
-- Pré-popula o controle numa obra CONCLUÍDA de empresa DEMO, para navegar o fluxo já com dados.
-- Seleciona pela empresa (is_demo) + nome estável da obra — não grava nada se a obra DEMO não existir
-- (ex.: pós-reset). ON CONFLICT (obra_id) DO NOTHING garante idempotência. Nunca toca dado de cliente real.
INSERT INTO public.erp_obra_retencao_garantia(
  company_id, obra_id,
  retencao_percentual, retencao_valor, retencao_data_prevista_liberacao, retencao_status, retencao_observacoes,
  garantia_prazo_meses, garantia_inicio, garantia_fim, garantia_status, garantia_observacoes)
SELECT o.company_id, o.id,
       5, round(COALESCE(o.valor_previsto, 0) * 0.05, 2),
       (COALESCE(o.data_conclusao, CURRENT_DATE) + INTERVAL '180 days')::date,
       'prevista',
       'Retenção de 5% sobre as medições, a devolver 180 dias após a entrega.',
       12, COALESCE(o.data_conclusao, CURRENT_DATE),
       (COALESCE(o.data_conclusao, CURRENT_DATE) + INTERVAL '12 months')::date,
       'vigente',
       'Garantia de 12 meses para instalações e acabamentos a contar da entrega.'
FROM public.projetos_obras o
JOIN public.companies c ON c.id = o.company_id
WHERE c.is_demo = true
  AND o.deleted_at IS NULL
  AND o.status = 'concluida'
  AND o.nome ILIKE 'Sala comercial%Horizonte%'
ON CONFLICT (obra_id) DO NOTHING;
