-- Hub · PDCA /dashboard/projetos/visitas (Eng. Chefe, caixa e10ef43c — auditor 24/10 06:03: 70/55/60).
-- Achados do auditor provados no banco (24/10):
--   (a) as 4 visitas da DEMO 006 mostram todas o mesmo horário (02:24 = hora em que a semente rodou): a semente usa
--       now() + delta, então a "hora da visita" é a hora do reset, não um horário de visita real;
--   (b) "Abrir orçamento" a partir da visita só existia na ficha da oportunidade (a tela agora gera direto — front).
--
-- 1) fn_demo_seed_construtora: a data da visita passa a ser o DIA (now() + delta, no fuso de São Paulo) em horário
--    comercial fixo por visita (09:00, 14:30, 10:00, 15:00). Patch por âncora sobre o corpo VIVO; aborta se a âncora sumir.
-- 2) Acerta o horário das 4 visitas da demo já gravadas (ids fixos da semente, só na 006 e só se is_demo).
-- 3) Texto do "?" das ações da visita (projetos.visitas.acoes) e do indicador "Realizadas sem orçamento" passa a citar o
--    botão novo "+ Gerar orçamento desta visita".
-- RD-55: nenhuma empresa real é tocada. Plano de volta: CREATE OR REPLACE com "now() + v.delta" no lugar da expressão nova.

-- ci-sem-guarda: fn_demo_seed_construtora — só a empresa de demonstração fixa do Hub (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.fn_demo_seed_construtora(uuid)'::regprocedure);
  v_new text;
BEGIN
  v_new := replace(v_def,
    'SELECT v.id::uuid, c, o.id, now() + v.delta, v.st,',
    E'SELECT v.id::uuid, c, o.id,\n         ((date_trunc(''day'', now() AT TIME ZONE ''America/Sao_Paulo'') + v.delta\n           + CASE right(v.id, 1) WHEN ''1'' THEN interval ''9 hours'' WHEN ''2'' THEN interval ''14 hours 30 minutes''\n                                 WHEN ''3'' THEN interval ''10 hours'' ELSE interval ''15 hours'' END)\n          AT TIME ZONE ''America/Sao_Paulo''), v.st,');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'fn_demo_seed_construtora: âncora "now() + v.delta" das visitas não encontrada';
  END IF;
  EXECUTE v_new;
END
$mig$;

REVOKE ALL ON FUNCTION public.fn_demo_seed_construtora(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_construtora(uuid) TO service_role;

DO $demo$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    UPDATE erp_crm_visita v
       SET data_visita = ((date_trunc('day', v.data_visita AT TIME ZONE 'America/Sao_Paulo') + h.hora) AT TIME ZONE 'America/Sao_Paulo')
      FROM (VALUES
        ('b0700000-0000-4000-a000-0000000d0101'::uuid, interval '9 hours'),
        ('b0700000-0000-4000-a000-0000000d0102'::uuid, interval '14 hours 30 minutes'),
        ('b0700000-0000-4000-a000-0000000d0103'::uuid, interval '10 hours'),
        ('b0700000-0000-4000-a000-0000000d0104'::uuid, interval '15 hours')
      ) AS h(id, hora)
     WHERE v.id = h.id
       AND v.company_id = 'b0700000-0000-4000-a000-000000000006'
       AND v.data_visita IS NOT NULL;
  END IF;
END
$demo$;

UPDATE erp_ajuda_campo
   SET o_que_preencher = 'Editar muda data, status, responsável, fotos e anotações. "+ Gerar orçamento desta visita" (visita realizada sem orçamento) cria o orçamento em rascunho ligado à oportunidade e à visita, sem sair da lista. Abrir oportunidade leva à ficha; Abrir orçamento mostra a proposta já criada.',
       exemplo = 'Visita realizada ontem: clique em "+ Gerar orçamento desta visita", confirme e depois em "Abrir orçamento" para lançar os itens.',
       erro_comum = 'Criar um orçamento avulso na tela de orçamentos: o vínculo com a visita e a oportunidade se perde e a visita continua em "Realizadas sem orçamento".',
       versao = versao + 1, atualizado_em = now()
 WHERE chave = 'projetos.visitas.acoes';

UPDATE erp_ajuda_campo
   SET para_que_serve = 'É o dinheiro parado: cliente visitado esperando proposta. Clique no número para ver essas visitas e use "+ Gerar orçamento desta visita" em cada uma.',
       versao = versao + 1, atualizado_em = now()
 WHERE chave = 'projetos.visitas.ind_sem_orcamento';
