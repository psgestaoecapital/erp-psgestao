-- HB2 · Assistente "Nova obra": "?" de ajuda nos dois campos (regra do Hub, gate check-ajuda-campo).
-- Aditiva: só INSERT de textos (ON CONFLICT DO NOTHING). Sem dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Nova obra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/obras/nova', 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.obra_nova.cliente', 'Cliente', 'O nome do cliente dono da obra, como você o conhece.', 'Liga a obra ao cliente; o cockpit e o resultado por obra mostram a obra sob esse nome.', 'FC Pisos Industriais', 'Deixar vazio sem informar nome ou endereço: o sistema pede ao menos um dos três.', 1),
 ('projetos.obra_nova.nome', 'Nome da obra', 'Opcional. Um nome curto para reconhecer a obra. Em branco, o sistema usa o endereço.', 'É o título da obra na lista e no cockpit. Não entra em nenhuma conta.', 'Galpão Logístico Norte', 'Repetir o nome de outra obra do mesmo cliente: o número automático é que diferencia.', 2)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
