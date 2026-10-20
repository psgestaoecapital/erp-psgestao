-- Pedido da Jordana (20/10, FC Pisos, ISS de Paraíso/SC): a tela "ISS por município"
-- (/dashboard/configuracoes/fiscal/iss-municipios) existe, mas o usuário não a encontra — só se chegava pelo endereço.
-- Agora a Configuração Fiscal tem o atalho "ISS por município" e a tela ganha o "?" em todos os campos (RD-95).
-- ADITIVA: só linhas novas no catálogo de telas (system_screens, metadado global, sem dono) e textos de ajuda
-- (erp_ajuda_campo). Nenhuma função, view, policy ou permissão é alterada; a tela segue com a mesma regra de acesso
-- da Configuração Fiscal (rota-filha de /dashboard/configuracoes/fiscal) e grava pela fn_fiscal_iss_cadastrar de sempre.

INSERT INTO public.system_screens (id, rota, titulo, area, modulo, estado_real, prioridade_monitoramento)
VALUES ('configuracoes.fiscal.iss_municipios', '/dashboard/configuracoes/fiscal/iss-municipios',
        'ISS por município', 'gestao_empresarial', 'fiscal', 'parcial', 'alta')
ON CONFLICT DO NOTHING;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Configuração Fiscal', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       v.rota, 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.config.iss_municipios', 'ISS por município', '/dashboard/configuracoes/fiscal',
  'Toque em Abrir para ver e cadastrar a alíquota de ISS de cada município onde a empresa presta serviço.',
  'Quando o serviço recolhe o ISS no local da prestação, a NFS-e busca aqui a alíquota do município da obra/serviço. Sem cadastro, a nota não sai.',
  'FC Pisos: Paraíso/SC, item 07.05, 3%.', 'Emitir para um município novo sem cadastrar antes a alíquota informada pelo contador.', 5),
 ('fiscal.iss.municipio', 'Município da execução', '/dashboard/configuracoes/fiscal/iss-municipios',
  'Digite o nome e escolha o município onde o serviço é executado (o local da prestação da nota).',
  'É a chave da busca: a NFS-e usa a alíquota do município informado como local da prestação.',
  'Paraíso/SC (IBGE 4212239).', 'Escolher a cidade do cliente em vez da cidade onde a obra/serviço acontece.', 1),
 ('fiscal.iss.lc116', 'Código LC 116 (subitem)', '/dashboard/configuracoes/fiscal/iss-municipios',
  'O subitem da lista de serviços (LC 116) com ponto, igual ao cadastrado no serviço da empresa.',
  'A nota só encontra a alíquota quando empresa + município + este código batem exatamente com o serviço emitido.',
  '07.05 (reparação e reforma de edifícios); 07.02 (execução de obra).', 'Digitar sem ponto (0705) ou com o código municipal (070501): a nota não acha a alíquota.', 2),
 ('fiscal.iss.aliquota', 'Alíquota (%)', '/dashboard/configuracoes/fiscal/iss-municipios',
  'O percentual de ISS desse município para esse serviço, informado pelo contador (de 0 a 10).',
  'Vira a alíquota de ISS da NFS-e e o valor do imposto (base × alíquota).',
  '3,00', 'Usar a alíquota do Simples (DAS) no lugar da alíquota do município.', 3),
 ('fiscal.iss.fonte', 'Origem do número', '/dashboard/configuracoes/fiscal/iss-municipios',
  'De onde veio a alíquota: contador, cadastro da empresa, acordo ou API do padrão nacional.',
  'Fica registrado para auditoria: quem conferir a nota sabe de onde saiu o número.',
  'Contador informou.', 'Deixar "contador" quando o número foi tirado de outra nota, sem confirmação.', 4),
 ('fiscal.iss.vigencia', 'Vigência a partir de', '/dashboard/configuracoes/fiscal/iss-municipios',
  'A data a partir da qual a alíquota vale. Ao cadastrar uma nova para o mesmo município e serviço, a anterior é encerrada.',
  'A nota usa a alíquota vigente na data da emissão; o histórico fica guardado.',
  '20/10/2026', 'Pôr data futura e emitir hoje: a nota não encontra alíquota vigente.', 5),
 ('fiscal.iss.informado_por', 'Quem informou', '/dashboard/configuracoes/fiscal/iss-municipios',
  'Opcional: o nome de quem passou a alíquota.',
  'Só registro, para saber a quem perguntar se o número mudar.',
  'Ervin (contador).', 'Colocar dado pessoal além do nome (telefone, CPF).', 6),
 ('fiscal.iss.retido', 'ISS retido na fonte', '/dashboard/configuracoes/fiscal/iss-municipios',
  'Marque quando, nesse município, o tomador do serviço retém o ISS e recolhe no lugar da empresa.',
  'A NFS-e sai com o ISS retido e o valor a receber desconta o imposto.',
  'Obra para prefeitura ou empresa que a lei municipal obriga a reter.', 'Marcar sem a lei/contador confirmar: o cliente paga a mais ou a menos.', 7),
 ('fiscal.iss.observacao', 'Observação', '/dashboard/configuracoes/fiscal/iss-municipios',
  'Opcional: a lei municipal, o ofício ou outra referência do número.',
  'Só registro, ajuda na conferência e na troca de contador.',
  'Lei complementar municipal 123/2024.', 'Usar o campo para recados que não são da alíquota.', 8),
 ('fiscal.iss.cadastrar', 'Cadastrar alíquota', '/dashboard/configuracoes/fiscal/iss-municipios',
  'Toque para gravar a alíquota com os dados acima.',
  'Vale para as próximas notas desse município e serviço; notas já emitidas não mudam.',
  '—', 'Esquecer de escolher o município na lista (só digitar o nome não basta).', 9),
 ('fiscal.iss.lista', 'Alíquotas cadastradas', '/dashboard/configuracoes/fiscal/iss-municipios',
  'Lista das alíquotas da empresa: as vigentes em cima e as encerradas (histórico) mais apagadas.',
  'É o que a NFS-e consulta. Para trocar uma alíquota, cadastre a nova com a data de início; a antiga vai para o histórico.',
  'Paraíso/SC · LC 07.05 · 3,00% · vigência 20/10/2026 (atual).', 'Procurar outra empresa: a lista mostra só a empresa selecionada no topo.', 10)
) AS v(chave, rotulo, rota, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
