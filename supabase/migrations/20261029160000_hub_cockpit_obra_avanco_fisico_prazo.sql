-- Hub · Cockpit da obra (/dashboard/projetos/obras/[id]/cockpit): "?" (RD-95) dos dois indicadores novos da tela —
-- "Avanço físico" (vem de projetos_obras.pct_conclusao) e "Prazo" (projetos_obras.data_prevista_fim).
-- Motivo (provado no banco 28/10, RD-38): a obra DEMO-OB-001 (…0006) tem pct_conclusao=50, data_prevista_fim=2026-12-04 e
-- cliente/cidade preenchidos, mas o cockpit da obra só mostrava os 4 cards financeiros — não exibia avanço físico nem prazo,
-- deixando a tela "parada" (sem o dado real que já existe). Esta migration só cadastra o texto de ajuda dos dois cards novos.
-- Aditiva: só texto de ajuda novo (erp_ajuda_campo); sem dado de cliente, sem RLS. Idempotente: ON CONFLICT (chave) DO NOTHING.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.cockpit.avanco_fisico', 'Cards do cockpit', 'Avanço físico',
  'Nada a preencher: vem do % de conclusão lançado no cronograma/medição física da obra ("Dados da obra").',
  'Mostra quanto da obra já foi executada em campo. Compare com o avanço financeiro ao lado: físico à frente do financeiro = execução ainda não medida/faturada; físico atrás = faturou mais do que executou.',
  'Físico 50% com financeiro 50% = em dia; físico 60% e financeiro 40% = medição atrasada.',
  'Confundir com o avanço financeiro: um é execução em campo, o outro é receita realizada sobre a prevista.',
  20, '/dashboard/projetos/obras/[id]/cockpit'),
 ('projetos.cockpit.prazo', 'Cards do cockpit', 'Prazo',
  'Nada a preencher: é a data prevista de término da obra, lançada em "Dados da obra".',
  'Avisa quantos dias faltam para a entrega e destaca em vermelho quando a data já passou e a obra ainda não foi concluída.',
  'Prazo 04/12/2026 · faltam 37 dias; se hoje já passou dessa data, aparece "vencido".',
  'Deixar a data prevista em branco: sem ela não dá para cobrar prazo nem gerar alerta de atraso.',
  21, '/dashboard/projetos/obras/[id]/cockpit')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
