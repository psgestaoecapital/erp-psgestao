-- #5461 (Pdois · P&M) — "Disponível para briefing": contrato recorrente ATIVO alimenta a tela de Briefing
-- com os serviços vendidos, para a equipe de criação ver o que foi vendido sem acessar o financeiro.
--
-- ADITIVA (RD-94.1c): coluna nova NULLABLE + função SOMENTE-LEITURA. Não altera RLS existente, não toca
-- dado de cliente, REVOKE anon. A tabela agency_briefings já tem RLS por empresa (agency_briefings_access).
--
-- Fonte dos serviços vendidos (provado no dado, RD-38): a PROPOSTA de P&M (agency_propostas) cujo contrato
-- de GE (erp_contratos) está ATIVO. Os itens vêm de agency_proposta_itens; quando a proposta não tem itens
-- cadastrados (ex.: CTR-2026-0004 / PROP-2026-0010, itens = []), cai no contrato inteiro (escopo/objeto).
-- NÃO expõe parcelas nem forma de pagamento (permissão: a equipe de P&M vê escopo e prazos, não o financeiro).

-- 1) Elo opcional do briefing com a proposta de origem (permite "Briefing realizado" por contrato e vários
--    briefings por item de contrato recorrente). Nullable + ON DELETE SET NULL = aditivo e reversível.
ALTER TABLE public.agency_briefings
  ADD COLUMN IF NOT EXISTS proposta_origem_id uuid REFERENCES public.agency_propostas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agency_briefings_proposta_origem
  ON public.agency_briefings (proposta_origem_id) WHERE proposta_origem_id IS NOT NULL;

COMMENT ON COLUMN public.agency_briefings.proposta_origem_id IS
  '#5461 · proposta de P&M (agency_propostas) de onde o briefing foi iniciado (contrato ativo → Disponível para briefing).';

-- 2) Itens "disponíveis para briefing" da empresa: serviços vendidos de contratos recorrentes ATIVOS.
CREATE OR REPLACE FUNCTION public.fn_pm_briefing_disponiveis(p_company_id uuid)
RETURNS TABLE (
  proposta_id uuid,
  proposta_numero text,
  contrato_id uuid,
  contrato_numero text,
  cliente_id uuid,
  cliente_nome text,
  item_id uuid,
  servico text,
  unidade text,
  periodicidade text,
  quantidade numeric,
  valor_unitario numeric,
  valor_total numeric,
  data_inicio date,
  data_fim date,
  objeto text,
  escopo text,
  condicoes text,
  briefings_feitos integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Guarda multi-empresa: só a própria empresa (ou admin). Sem acesso → vazio (não vaza dado de outra empresa).
  IF p_company_id IS NULL THEN RETURN; END IF;
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.id               AS b_proposta_id,
           p.numero           AS b_proposta_numero,
           p.cliente_id       AS b_cliente_id,
           p.titulo           AS b_titulo,
           c.id               AS b_contrato_id,
           c.numero           AS b_contrato_numero,
           c.data_inicio      AS b_data_inicio,
           c.data_fim         AS b_data_fim,
           c.valor_mensal     AS b_valor_mensal,
           c.periodicidade::text AS b_periodicidade,
           c.objeto           AS b_objeto,
           c.escopo           AS b_escopo,
           c.condicoes_especificas AS b_condicoes
    FROM public.agency_propostas p
    JOIN public.erp_contratos c
      ON c.id = p.contrato_id
     AND c.excluido_em IS NULL
     AND lower(c.status) = 'ativo'
    WHERE p.company_id = p_company_id
      AND p.deleted_at IS NULL
      AND p.contrato_id IS NOT NULL
  ),
  linhas AS (
    -- serviços vendidos (itens da proposta)
    SELECT b.b_proposta_id, b.b_proposta_numero, b.b_contrato_id, b.b_contrato_numero, b.b_cliente_id,
           i.id AS l_item_id,
           COALESCE(NULLIF(btrim(i.descricao), ''), NULLIF(btrim(i.tipo_servico), ''), 'Serviço') AS l_servico,
           i.unidade AS l_unidade,
           COALESCE(NULLIF(btrim(i.periodicidade), ''), b.b_periodicidade) AS l_periodicidade,
           COALESCE(i.quantidade, 1) AS l_quantidade,
           i.valor_unitario AS l_valor_unitario,
           i.valor_total AS l_valor_total,
           b.b_data_inicio, b.b_data_fim, b.b_objeto, b.b_escopo, b.b_condicoes
    FROM base b
    JOIN public.agency_proposta_itens i
      ON i.proposta_id = b.b_proposta_id AND i.excluido_em IS NULL
    UNION ALL
    -- proposta sem itens → 1 linha do contrato inteiro (ex.: CTR-2026-0004)
    SELECT b.b_proposta_id, b.b_proposta_numero, b.b_contrato_id, b.b_contrato_numero, b.b_cliente_id,
           NULL::uuid AS l_item_id,
           COALESCE(NULLIF(btrim(b.b_escopo), ''), NULLIF(btrim(b.b_objeto), ''), NULLIF(btrim(b.b_titulo), ''), 'Serviço do contrato') AS l_servico,
           NULL::text AS l_unidade,
           b.b_periodicidade AS l_periodicidade,
           1::numeric AS l_quantidade,
           b.b_valor_mensal AS l_valor_unitario,
           b.b_valor_mensal AS l_valor_total,
           b.b_data_inicio, b.b_data_fim, b.b_objeto, b.b_escopo, b.b_condicoes
    FROM base b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.agency_proposta_itens i
      WHERE i.proposta_id = b.b_proposta_id AND i.excluido_em IS NULL
    )
  )
  SELECT l.b_proposta_id, l.b_proposta_numero, l.b_contrato_id, l.b_contrato_numero, l.b_cliente_id,
         COALESCE(cl.nome_fantasia, cl.nome) AS cliente_nome,
         l.l_item_id, l.l_servico, l.l_unidade, l.l_periodicidade, l.l_quantidade,
         l.l_valor_unitario, l.l_valor_total, l.b_data_inicio, l.b_data_fim,
         l.b_objeto, l.b_escopo, l.b_condicoes,
         COALESCE((
           SELECT count(*) FROM public.agency_briefings bf
           WHERE bf.proposta_origem_id = l.b_proposta_id
             AND bf.company_id = p_company_id
             AND bf.excluido_em IS NULL
         ), 0)::int AS briefings_feitos
  FROM linhas l
  LEFT JOIN public.agency_clientes cl ON cl.id = l.b_cliente_id
  ORDER BY l.b_contrato_numero, l.l_servico;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_pm_briefing_disponiveis(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_briefing_disponiveis(uuid) TO authenticated, service_role;

-- 3) Ajuda "?" (RD-95) das novas ações/abas da tela de Briefings.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT v.chave, '/dashboard/pm/briefings', v.grupo, v.rotulo, v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum, 'pm', v.ordem, 'publicado'
FROM (VALUES
  ('pm.briefing.aba_disponivel', 'Briefings · Abas', 'Disponível para briefing',
   'Mostra os serviços vendidos nos contratos recorrentes ATIVOS que ainda podem virar briefing.',
   'A equipe de criação ver o que foi vendido e começar o briefing sem acessar o financeiro.',
   'Contrato ativado no financeiro → o serviço aparece aqui para iniciar o briefing.',
   'Se o contrato não está ativo, o serviço não aparece: ative o contrato primeiro.', 7),
  ('pm.briefing.aba_realizado', 'Briefings · Abas', 'Briefing realizado',
   'Lista os briefings já criados (inclusive os iniciados a partir de um contrato).',
   'Acompanhar o que já foi briefado e levar para job/planejamento.',
   'Depois de salvar um briefing, ele aparece nesta aba.',
   'Briefing excluído não aparece aqui (fica só na auditoria).', 8),
  ('pm.briefing.iniciar_do_contrato', 'Briefings · Ações', 'Iniciar briefing',
   'Abre um briefing novo já preenchido com os dados do contrato (cliente, serviço, objeto).',
   'Começar o briefing do que foi vendido sem redigitar os dados do contrato.',
   'Disponível para briefing → Iniciar briefing → ajusta e salva.',
   'Confira o cliente e o serviço preenchidos antes de salvar.', 9)
) AS v(chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
