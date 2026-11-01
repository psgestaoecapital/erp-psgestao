-- Viagem · relatório: chave de ajuda "?" do botão "Exportar CSV" (RD-95, desenvolvedor_4_g, faixa 52).
-- SÓ ACRESCENTA um texto de ajuda no catálogo global erp_ajuda_campo (sem dono). Nenhuma tabela, função ou view é
-- alterada; nenhum UPDATE/DELETE em dado de cliente. O botão exporta, no próprio navegador, o relatório de custo de
-- viagem por obra que a tela JÁ carregou (fn_viagem_relatorio) — formata o que está na tela, não calcula nada novo.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.rel_exportar', 'Relatório', 'Exportar CSV',
   'Clique para baixar o relatório de custo de viagem por obra em CSV (abre no Excel ou no Google Planilhas).',
   'Gera o arquivo com o que está na tela: uma linha por obra (viagens, custo no período, dividido entre obras e custo no Resultado da obra) e a linha de total — a mesma conta do Resultado da obra.',
   'Baixar o custo de viagem da obra DEMO-FC-001 para anexar na reunião de medição.',
   'Baixar antes de escolher a obra ou o período no filtro: o arquivo sai com todas as viagens, não só as que você queria.',
   27)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
