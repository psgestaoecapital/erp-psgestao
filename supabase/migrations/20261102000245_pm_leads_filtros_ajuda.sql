-- PDCA P&M · /dashboard/pm/leads · RD-95: "?" na BARRA DE FILTROS.
-- Gap (aud8claudeps 31/10): busca, Origem, Responsável e Período só tinham aria-label,
-- sem AjudaCampo. Esta migration ADITIVA cadastra as 4 chaves de ajuda; o front passa a
-- renderar o "?" em cada filtro. Idempotente (não recria chave existente).

INSERT INTO public.erp_ajuda_campo
  (rota, chave, grupo, ordem, rotulo, status, versao, vertical, o_que_preencher, para_que_serve, exemplo, erro_comum)
SELECT v.rota, v.chave, v.grupo, v.ordem, v.rotulo, 'publicado', 1, 'pm',
       v.o_que_preencher, v.para_que_serve, v.exemplo, v.erro_comum
FROM (VALUES
  ('/dashboard/pm/leads', 'pm.leads.filtro_busca', 'Leads (Funil)', 10, 'Buscar',
   'Digite parte do contato, da empresa ou do e-mail do lead.',
   'Encontra rápido um lead específico sem percorrer o funil inteiro.',
   'Digitar "silva" lista todos os leads cujo contato, empresa ou e-mail contém "silva".',
   'A busca é por texto parcial — não precisa do nome completo nem diferenciar maiúsculas.'),
  ('/dashboard/pm/leads', 'pm.leads.filtro_origem', 'Leads (Funil)', 11, 'Origem',
   'Escolha a origem do lead (indicação, site, anúncio, etc.) ou deixe em "todas".',
   'Separa de onde vêm os leads para medir qual canal traz mais negócio.',
   'Selecionar "Indicação" mostra só os leads que chegaram por indicação.',
   'Origem vazia no cadastro do lead faz ele não aparecer ao filtrar por um canal específico.'),
  ('/dashboard/pm/leads', 'pm.leads.filtro_responsavel', 'Leads (Funil)', 12, 'Responsável',
   'Filtre pelos leads de um responsável, ou use "Meus leads" para ver os seus.',
   'Foca a visão em quem está cuidando de cada lead e distribui a carteira.',
   '"Meus leads" mostra apenas os leads em que você é o responsável.',
   'Lead sem responsável definido não aparece ao filtrar por uma pessoa.'),
  ('/dashboard/pm/leads', 'pm.leads.filtro_periodo', 'Leads (Funil)', 13, 'Período',
   'Escolha o período (mês, trimestre, ano ou personalizado) pela data de entrada do lead.',
   'Analisa os leads de uma janela de tempo para medir geração por período.',
   '"Mês atual" mostra só os leads que entraram neste mês.',
   'No modo "Personalizado" é preciso preencher início e fim; sem isso o filtro não limita nada.')
) AS v(rota, chave, grupo, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
