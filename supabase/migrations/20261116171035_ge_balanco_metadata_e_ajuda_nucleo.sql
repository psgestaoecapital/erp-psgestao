-- GE · Balanço Patrimonial (NÚCLEO universal) — PDCA auditor_pdca_2 15/11.
-- Acompanha a troca, no front, do hook da pecuária (useEmpresaSelecionada de '@/lib/agro/usePecuaria')
-- pelo seletor genérico useCompanyIds. Balanço serve a qualquer ramo e não pode depender do agro.
--
-- (1) RD-98 pilar 3 (origem do dado): a metadata desta rota ainda listava o resquício agro
--     (views_consumidas=['erp_pec_propriedade'], rpcs com fn_pec_painel_rebanho). Corrige para as
--     fontes REAIS que a tela consome (via fn_balanco_patrimonial e as RPCs de linha manual).
-- (2) RD-95: o modal premium que substitui os window.prompt ("Adicionar linha manual") ganha "?" em
--     cada campo (nome e valor) — chaves de ajuda novas, idempotentes.
--
-- Aditiva/idempotente. Não toca dado de cliente, RLS, fiscal nem financeiro. Prova RD-38 no corpo da PR.

-- (1) Metadata da rota: fontes reais (sem resquício agro) -------------------------------------------
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
         'v_receber_efetivo','erp_produtos','erp_pagar','erp_bem','erp_bem_depreciacao','balanco_patrimonial'
       ]::text[],
       rpcs_chamadas = ARRAY[
         'fn_balanco_patrimonial','fn_balanco_linha_salvar','fn_balanco_linha_excluir','fn_balanco_copiar_periodo',
         'fn_saldo_bancos_dinamico','fn_registrar_evento_auth','fn_registrar_travamento'
       ]::text[]
 WHERE rota = '/dashboard/gestao-empresarial/balanco-patrimonial';

-- (2) Ajuda "?" dos campos do modal de nova linha manual (RD-95) ------------------------------------
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('ge.balanco.linha_nome',
   '/dashboard/gestao-empresarial/balanco-patrimonial',
   'Linhas',
   'Nome da linha manual',
   'O nome da conta que você está lançando dentro do grupo (ex.: Capital Social, Reservas, Empréstimo bancário). Escreva do jeito que aparece no seu plano de contas.',
   'Identifica a linha no balanço. É o rótulo que aparece na lista e soma no total do grupo.',
   'Capital Social',
   'Deixar o nome em branco: a linha precisa de um nome para ser salva.',
   'gestao_empresarial', 20, 1, 'publicado'),
  ('ge.balanco.linha_valor',
   '/dashboard/gestao-empresarial/balanco-patrimonial',
   'Linhas',
   'Valor da linha (R$)',
   'O valor em reais desta conta no período. Digite só os números — a máscara formata os centavos sozinha. Deixe em branco se ainda não souber o valor (fica como "a apurar").',
   'Entra na soma do grupo e no total do Ativo ou do Passivo + Patrimônio Líquido, aproximando o balanço do fechamento.',
   '100.000,00',
   'Digitar pontos/vírgula na mão: basta digitar os números, a máscara cuida do formato.',
   'gestao_empresarial', 21, 1, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave
);
