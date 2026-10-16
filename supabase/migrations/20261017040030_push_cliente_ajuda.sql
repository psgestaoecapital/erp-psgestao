-- Chamado #120 — textos do "?" (RD-95) da tela Avisos no celular. Só dado de ajuda; aditiva.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Configurações', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/configuracoes/notificacoes-celular', 'hub', 'publicado'
FROM (VALUES
 ('config.notificacao_celular.etapa', 'Aviso de mudança de etapa', 'Nada a preencher: mostra se este aparelho recebe o aviso quando uma oportunidade sua muda de etapa.', 'É o mesmo aviso do sininho do sistema, entregue também na central de notificações do celular, mesmo com o app fechado.', 'A proposta passou para Negociação: o celular vibra e mostra o aviso.', 'No iPhone, o aviso só chega se o app estiver na tela de início.', 1),
 ('config.notificacao_celular.botao', 'Ligar neste aparelho', 'Toque para ligar e permita as notificações quando o celular perguntar. Toque de novo para desligar.', 'Cada aparelho liga o seu. Desligar apaga o cadastro deste aparelho.', 'Ligou no celular e no tablet: os dois recebem.', 'Negar a permissão: o celular bloqueia e é preciso liberar nos ajustes do navegador.', 2)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
