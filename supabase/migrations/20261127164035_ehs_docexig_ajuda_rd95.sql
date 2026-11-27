-- RD-95: "?" dos campos da tela EHS · Documentos Exigidos (/dashboard/ehs/documentos-exigidos).
-- Só ADITIVA e idempotente: chaves novas em erp_ajuda_campo (ON CONFLICT (chave) DO NOTHING).
-- Nenhuma função, policy, grant ou dado de cliente é alterado — a tela já usa o backend existente
-- (fn_compliance_exigidos_listar / _toggle / _escopo_salvar / _custom_salvar / _remover, com guarda de empresa).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/ehs/documentos-exigidos', 'ehs', 'publicado'
FROM (VALUES
 ('ehs.docexig.marcar', 'Documentos do catálogo', 'Exigir este documento',
  'Marque a caixa dos documentos que a sua empresa exige para o perfil da aba atual (Funcionários próprios, Terceiros/Prestadores ou Funcionários do terceiro). Desmarque o que não se aplica à sua realidade.',
  'O que você marca aqui vira a lista de pendências na ficha de cada pessoa deste perfil: só os documentos marcados são cobrados e entram no alerta de vencimento.',
  'ASO e Ficha de EPI marcados para Funcionários próprios; para Terceiros, marque também o contrato e a documentação da prestadora.',
  'Marcar tudo do catálogo: a ficha fica cheia de pendências que a sua empresa não cobra de verdade. Marque só o que exige.', 10),
 ('ehs.docexig.custom_nome', 'Documento próprio', 'Nome do documento próprio',
  'Dê um nome claro a um documento que a sua empresa exige mas não está no catálogo comum. Ele passa a aparecer na lista junto com os do catálogo.',
  'Cria uma exigência própria da sua empresa, cobrada na ficha das pessoas do perfil da aba atual, igual aos documentos do catálogo.',
  'Ficha de integração interna; Termo de confidencialidade; Crachá de acesso.',
  'Criar um próprio que já existe no catálogo com outro nome: marque o do catálogo (tem base legal e código eSocial) em vez de duplicar.', 20),
 ('ehs.docexig.custom_validade', 'Documento próprio', 'Validade (dias)',
  'Quantos dias o documento vale a partir da data de entrega. Deixe em branco para documento que não vence.',
  'Define quando o documento volta a ser cobrado: a ficha da pessoa alerta e marca como vencido depois desse prazo.',
  '365 para um documento anual; em branco para um termo que não expira.',
  'Pôr 0: é lido como vencido no mesmo dia da entrega. Para "nunca vence", deixe o campo em branco.', 30),
 ('ehs.docexig.custom_obrigatorio', 'Documento próprio', 'Obrigatório',
  'Marque se a falta deste documento deve impedir a liberação da pessoa. Desmarque para um documento desejável, mas não impeditivo.',
  'Documento obrigatório pendente conta como bloqueio na situação da pessoa; o opcional aparece só como pendência leve, sem bloquear.',
  'ASO: obrigatório. Foto 3x4: opcional.',
  'Deixar tudo como opcional: nada bloqueia e a cobrança perde força. Marque como obrigatório o que de fato impede o trabalho.', 40),
 ('ehs.docexig.escopo', 'Documentos do catálogo', 'Aplicar só a cargos/setores',
  'Por padrão o documento vale para todos. Para cobrá-lo só de parte das pessoas, escolha um cargo e/ou um setor; deixe em "todos" para não restringir. Use "limpar" para voltar a valer para todos.',
  'Restringe a exigência: só as pessoas do cargo e/ou do setor escolhidos passam a ter esse documento cobrado na ficha. Vazio nos dois = cobrado de todos do perfil.',
  'NR-35 (trabalho em altura) só para o cargo "Montador"; crachá só para o setor "Produção".',
  'Escolher um cargo achando que amplia a cobrança: na verdade restringe — todos os outros cargos deixam de ser cobrados desse documento.', 50)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
