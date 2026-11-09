-- RD-95: "?" nos cards do dashboard da Gestão Empresarial (/dashboard/gestao-empresarial, DashboardRico).
-- Gap do auditor aud8claudeps (nota 82): os cards Saúde Financeira (semáforo), Contas financeiras, Fluxo de
-- Caixa e Maiores inadimplentes não tinham "?". Os KPIs do topo (ge.hub.kpi.*) e o Hero de saldo bancário já
-- tinham. ADITIVA: só o texto do "?" (RD-95), sem tabela, função ou dado de cliente — os cards já leem pela RLS
-- da empresa (fn_ge_saude_financeira / fn_saldos_empresa / fn_gestao_empresarial_widget_fluxo_caixa /
-- fn_ge_top_inadimplentes).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Gestão Empresarial', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/gestao-empresarial', 'financeiro', 'publicado'
FROM (VALUES
  ('ge.hub.semaforo_saude', 'Saúde Financeira',
   'Nada a preencher: é uma nota de 0 a 100 calculada pelo sistema a partir do caixa, da inadimplência e da concentração de clientes da empresa.',
   'Dá um retrato rápido da saúde do negócio. Verde = saudável, amarelo = atenção, vermelho = risco. Clique em "Ver detalhes" para o painel completo de Saúde Financeira.',
   'Nota 78 · classificação "Saudável": caixa cobre vários meses e a inadimplência está baixa.',
   'Tratar a nota como valor contábil exato: é um indicador-resumo; os números de origem estão no painel de Saúde Financeira.', 1),
  ('ge.hub.contas_financeiras', 'Contas financeiras',
   'Nada a preencher aqui: a lista mostra suas contas por tipo (bancárias, caixa, cartões) e o saldo de cada uma, com a ORIGEM do saldo.',
   'Mostra de onde vem cada saldo: "lido do extrato" (OFX/API do banco) é conciliado; "manual" foi digitado; "— sem leitura de extrato" ainda não tem extrato (aparece "—", nunca R$ 0,00 falso). O gerencial soma os títulos baixados naquela conta.',
   'Conta "Itaú PJ" R$ 12.450,00 ✅ lido do OFX; "Caixa loja" ✎ manual.',
   'Confundir saldo bancário (extrato) com gerencial (títulos baixados): são linhas diferentes no mesmo cartão. "—" não é saldo zero: é falta de leitura de extrato.', 2),
  ('ge.hub.fluxo_caixa', 'Fluxo de Caixa',
   'Nada a preencher: é a projeção de entradas e saídas do caixa para os próximos dias, com o saldo projetado e a mini-tendência.',
   'Antecipa se o caixa fica positivo ou negativo. Entradas = recebíveis previstos; saídas = contas a pagar. Clique no card para o fluxo completo.',
   'Saldo projetado R$ 8.300 em 30 dias, tendência de alta: as entradas previstas superam as saídas.',
   'Ler como saldo de hoje: é PROJEÇÃO por vencimento. Título em aberto entra pela data prevista, não pela realizada.', 3),
  ('ge.hub.inadimplentes', 'Maiores inadimplentes',
   'Nada a preencher: lista os 3 clientes com maior valor vencido em aberto (dias de atraso e total). "Ver todos" abre a tela de Inadimplentes.',
   'Prioriza a cobrança: mostra onde está o maior dinheiro parado. Cliente sem nome no cadastro aparece como "Cliente sem cadastro" (nunca em branco).',
   'Cliente "Padaria Aurora" atrasado 42 dias · R$ 3.180,00 no topo da lista.',
   'Achar que são todos os devedores: é o TOP 3 por valor. Use "Ver todos" para a lista completa e a régua de cobrança.', 4)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
