-- Hub · /dashboard/projetos/mao-obra — delta até 95 (aud8/Max 27/10, caixa aeb7f712 · Code: desenvolvedor_4_g)
-- RD-95: o modal de Histórico (Vigência / Salário/valor / Custo mensal / Hora / Motivo) era a única tabela da tela
-- sem "?" por coluna. Cadastra as 5 chaves do histórico (as demais colunas e campos já tinham o "?").
-- RD-98 p3: a tela estava sem views_consumidas/rpcs_chamadas em system_screens — preenche os RPCs reais da página
-- (a tela não consome nenhuma view v_* diretamente: tudo passa por fn_mao_obra_*; views_consumidas fica null, verdade no dado).
-- Migration ADITIVA (RD-94.1 c): só dados de ajuda + metadados de system_screens; nenhuma função/RLS/view tocada.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Histórico', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/projetos/mao-obra', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.mao_obra.hist.vigencia','Vigência','Não se preenche. É o período em que cada valor valeu.','Mostra de quando até quando cada salário/valor foi usado no custo da função.','01/03/2026 → hoje','Confundir a data do reajuste com a data em que a ficha foi lançada.',301),
 ('projetos.mao_obra.hist.valor','Salário/valor','Não se preenche aqui. É o salário (CLT) ou o valor por unidade registrado na ficha do período.','Guarda a base da remuneração que gerou o custo daquele período.','R$ 2.800,00','Comparar direto com o custo da empresa: o custo é sempre maior que o salário.',302),
 ('projetos.mao_obra.hist.mensal','Custo mensal','Não se preenche. É o resultado do período.','Soma salário, adicionais, encargos, provisões e benefícios daquele período.','R$ 5.547,03','Esperar que seja igual ao salário.',303),
 ('projetos.mao_obra.hist.hora','Hora','Não se preenche. É o custo da hora do período.','Custo mensal dividido pelas horas produtivas; é o valor que o catálogo usou naquele período.','R$ 31,52','Dividir o salário por 220 h: aqui entram encargos e as horas produtivas reais.',304),
 ('projetos.mao_obra.hist.motivo','Motivo','Não se preenche aqui. Vem do reajuste ou do encerramento.','Explica por que o valor mudou (reajuste, correção, desligamento) — fica para auditoria.','Reajuste anual','Deixar sem motivo: dificulta entender a mudança depois.',305)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical, status = EXCLUDED.status;

-- RD-98 p3: RPCs reais chamados por src/app/dashboard/projetos/mao-obra/page.tsx (grep do arquivo)
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY[
        'fn_mao_obra_listar','fn_mao_obra_funcoes_modelo','fn_mao_obra_funcao_salvar','fn_mao_obra_funcao_unir',
        'fn_mao_obra_ficha_salvar','fn_mao_obra_ficha_conferir','fn_mao_obra_ficha_reajustar','fn_mao_obra_ficha_encerrar',
        'fn_mao_obra_ficha_historico','fn_mao_obra_encargos_salvar']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/mao-obra';
