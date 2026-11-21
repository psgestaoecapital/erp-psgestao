-- RD-95: "?" da ação nova "Editar valor" na modal "Oportunidades Ganhas" (Funil do Hub de Projetos).
-- PR-B do SPEC: permite corrigir o valor de uma oportunidade já marcada como ganha (erro de digitação),
-- com rastro automático (trg_crm_oport_historico grava valor_antes/valor_depois/autor). UI-only; nenhum
-- backend novo. Tabela global de referência (sem company_id), chave única; re-rodar só atualiza o texto.

INSERT INTO public.erp_ajuda_campo (chave, rota, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  (
    'projetos.oportunidades.editar_valor_ganha',
    '/dashboard/projetos/oportunidades',
    'Editar valor (ganha)',
    'Abre a oportunidade já ganha para você corrigir o valor que foi lançado errado. Altere só o valor e salve — a oportunidade continua marcada como ganha.',
    'Serve para acertar um valor digitado errado numa venda já fechada, sem reabrir a negociação. Toda alteração fica registrada (quem alterou, quando e de quanto para quanto) no histórico da oportunidade.',
    'A venda foi lançada como R$ 10.000 por engano; o correto era R$ 12.800. Use "Editar valor" para corrigir — a mudança aparece no histórico da ficha.',
    'Tentar editar uma venda de outro vendedor em empresa com carteira: o sistema recusa e avisa. Editar o valor NÃO remove o status de ganha nem apaga nada.',
    'projetos',
    43
  )
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota,
  rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo,
  erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem,
  status = 'publicado',
  atualizado_em = now();
