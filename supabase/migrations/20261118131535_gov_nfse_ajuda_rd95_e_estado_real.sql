-- RD-95 · NFSe Nacional gov.br (/dashboard/fiscal/gov-nfse): a tela de diagnóstico da Fase 1
-- (lê municípios aderidos cacheados e DPSes pendentes) não tinha NENHUM "?" (AjudaCampo=0).
-- Esta migration cadastra a ajuda das colunas das duas tabelas, dos indicadores de contagem e da
-- ação "Sincronizar municípios", na rota exata da tela (fn_ajuda_campo_listar casa por rota).
--
-- RD-98 pilar 3 (origem do dado) + selo: corrige system_screens.estado_real de 'placeholder' para
-- 'parcial' (Fase 1 lê dado real; emissão mTLS da Fase 2 pendente) e preenche rpcs_chamadas com a
-- edge de sincronização. views_consumidas já estava correta.
--
-- ADITIVO e idempotente (ON CONFLICT DO NOTHING / UPDATE pontual na própria linha de metadado da tela,
-- não é dado de cliente). Nenhum dado de cliente tocado.
-- RD-52: arquivo em supabase/migrations + PR (faixa code-desenvolvedor-3 :35, acima da main).

-- 1) RD-95: "?" de cada coluna, indicador e ação da tela
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 -- Indicadores de contagem
 ('fiscal.gov_nfse.ind.municipios_aderidos','/dashboard/fiscal/gov-nfse','Indicadores','Municípios aderidos','Indicador. Mostra quantos municípios do cache local já aderiram ao Sistema Nacional de NFS-e (padrão gov.br).','Diz em quantas cidades a emissão pelo padrão nacional já está disponível. Só municípios aderidos aceitam a DPS pelo endpoint nacional.','3 municípios aderidos — a emissão nacional funciona nessas 3 cidades.','Achar que "poucos aderidos" é erro do sistema: a adesão depende de cada prefeitura; use "Sincronizar municípios" para atualizar.','gestao_empresarial',10,'publicado'),
 ('fiscal.gov_nfse.ind.dps_pendentes','/dashboard/fiscal/gov-nfse','Indicadores','DPSes pendentes','Indicador. Conta as DPSes (Declaração de Prestação de Serviço) registradas localmente e ainda não transmitidas.','Mostra o volume de notas aguardando a transmissão efetiva (Fase 2, mTLS). Na Fase 1 elas ficam registradas localmente.','5 pendentes — há 5 DPSes registradas esperando a emissão nacional.','Esperar que a pendente "suma" sozinha na Fase 1: a transmissão real entra na Fase 2.','gestao_empresarial',20,'publicado'),
 -- Ação
 ('fiscal.gov_nfse.acao.sincronizar','/dashboard/fiscal/gov-nfse','Ações','Sincronizar municípios','Ação (botão). Busca na Receita Federal a lista atualizada de municípios aderidos ao padrão nacional e atualiza o cache local.','Mantém a lista de cidades aderidas em dia, para você saber onde a emissão nacional já está disponível.','Clicar quando uma prefeitura nova passa a aceitar o padrão nacional, para ela aparecer na lista.','Clicar repetidamente sem necessidade: a adesão muda devagar; sincronize de tempos em tempos.','gestao_empresarial',30,'publicado'),
 -- Colunas: Municípios aderidos
 ('fiscal.gov_nfse.munic.codigo_ibge','/dashboard/fiscal/gov-nfse','Municípios','Código IBGE','Coluna. Código de 7 dígitos que o IBGE dá a cada município brasileiro.','Identifica o município de forma única na emissão nacional; é o código que vai na DPS.','3550308 é o código de São Paulo (SP).','Confundir com o código do cartório ou da prefeitura: aqui é sempre o código do IBGE.','gestao_empresarial',40,'publicado'),
 ('fiscal.gov_nfse.munic.nome','/dashboard/fiscal/gov-nfse','Municípios','Nome','Coluna. Nome do município.','Facilita localizar a cidade na lista sem decorar o código IBGE.','São Paulo, Campinas, Santos.','—','gestao_empresarial',50,'publicado'),
 ('fiscal.gov_nfse.munic.uf','/dashboard/fiscal/gov-nfse','Municípios','UF','Coluna. Sigla do estado (unidade federativa) do município.','Distingue cidades de mesmo nome em estados diferentes.','SP, RJ, MG.','—','gestao_empresarial',60,'publicado'),
 ('fiscal.gov_nfse.munic.aderiu_em','/dashboard/fiscal/gov-nfse','Municípios','Aderiu em','Coluna. Data em que o município passou a aceitar o padrão nacional de NFS-e.','Mostra desde quando a emissão nacional está disponível naquela cidade.','15/03/2026.','Vazio (—) não quer dizer que não aderiu: pode ser que a data de adesão ainda não tenha vindo na sincronização.','gestao_empresarial',70,'publicado'),
 -- Colunas: DPSes pendentes
 ('fiscal.gov_nfse.dps.numero','/dashboard/fiscal/gov-nfse','DPSes pendentes','Nº DPS','Coluna. Número sequencial da Declaração de Prestação de Serviço registrada.','Identifica a DPS para acompanhar a transmissão e conferir com a nota emitida.','1042.','—','gestao_empresarial',80,'publicado'),
 ('fiscal.gov_nfse.dps.data','/dashboard/fiscal/gov-nfse','DPSes pendentes','Data','Coluna. Data e hora em que a DPS foi registrada no sistema.','Mostra há quanto tempo a nota está aguardando a transmissão.','16/11/2026 14:30.','—','gestao_empresarial',90,'publicado'),
 ('fiscal.gov_nfse.dps.descricao','/dashboard/fiscal/gov-nfse','DPSes pendentes','Descrição','Coluna. Descrição do serviço prestado que consta na DPS.','Ajuda a reconhecer a qual serviço a nota se refere.','Consultoria em gestão — novembro/2026.','—','gestao_empresarial',100,'publicado'),
 ('fiscal.gov_nfse.dps.valor','/dashboard/fiscal/gov-nfse','DPSes pendentes','Valor','Coluna. Valor do serviço (base da nota), em reais.','É o valor que será transmitido na emissão nacional.','R$ 2.500,00.','—','gestao_empresarial',110,'publicado'),
 ('fiscal.gov_nfse.dps.status','/dashboard/fiscal/gov-nfse','DPSes pendentes','Status','Coluna. Situação da DPS no fluxo de emissão (ex.: processando, pendente).','Mostra em que etapa a nota está. Na Fase 1 as DPSes ficam registradas aguardando a transmissão da Fase 2.','processando.','Esperar status "autorizada" na Fase 1: a autorização real depende da transmissão mTLS (Fase 2).','gestao_empresarial',120,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 2) RD-98: estado_real correto + rpcs_chamadas (metadado da própria tela, não é dado de cliente)
UPDATE public.system_screens
   SET estado_real  = 'parcial',
       rpcs_chamadas = ARRAY['gov-nfse-sync-municipios (edge function)']
 WHERE rota = '/dashboard/fiscal/gov-nfse'
   AND estado_real IS DISTINCT FROM 'parcial';
