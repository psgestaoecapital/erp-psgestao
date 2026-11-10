-- Linhas de negócio › Configurar (/dashboard/linhas-negocio/configurar) · PDCA auditor (tarefa e8f95e77) · Code: desenvolvedor_4_g
-- RD-95: a sub-rota de configuração não tinha "?" nos campos do formulário "Nova linha de negócio"
-- (nome, descrição e cor identificadora). Esta migration (ADITIVA, idempotente, NÃO altera dado de cliente)
-- só acrescenta as chaves de ajuda desses campos. A conversão visual para a paleta PS (RD-96) vai no mesmo PR (front).
-- Faixa de migration do desenvolvedor_4_g (segundos :45–:54), acima da main.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Nova linha de negócio', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/linhas-negocio/configurar', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('linhas_negocio.configurar.nome','Nome da linha','Dê um nome curto e claro para a linha de negócio (uma frente de receita/produto da empresa).','O ERP passa a separar receita, custo e margem de contribuição por linha, para você ver qual negócio dá mais resultado.','"Bovinos", "Automação Industrial", "Serviços de Manutenção".','Nome genérico demais ("Diversos") atrapalha a análise — prefira uma linha por frente real de negócio.',10),
 ('linhas_negocio.configurar.descricao','Descrição','Texto opcional que explica o que entra nessa linha (produtos, serviços ou clientes que ela agrupa).','Ajuda a equipe a classificar lançamentos na linha certa e a lembrar o critério usado.','"Venda e abate de gado de corte" ou "Projetos de automação para a indústria".','Deixar vago faz lançamentos irem para a linha errada; descreva o que pertence a ela.',11),
 ('linhas_negocio.configurar.cor','Cor identificadora','Escolha uma cor para a linha; ela identifica a linha nos gráficos e relatórios (margem, DRE, waterfall).','Dá leitura visual rápida de cada linha nos painéis, sem precisar ler o nome toda vez.','Dourado para "Bovinos", verde para "Serviços".','Usar a mesma cor em duas linhas confunde a leitura dos gráficos — escolha cores distintas.',12)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
