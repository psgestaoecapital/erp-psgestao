-- RD-95 ("?" em todo indicador) · Diagnóstico da Oficina — tela de SELEÇÃO (escolher qual OS/veículo diagnosticar).
-- Gap do auditor: "busca e selos 'já tem laudo / toque p/ editar' com apenas 3 AjudaCampo; conferir cobertura de '?'
-- em todos os campos/indicadores da seleção." A busca já tinha "?"; faltava explicar a LISTA de seleção e o SELO
-- "já tem laudo". Semeia 2 chaves na rota /dashboard/oficina/diagnostico. Catálogo de ajuda é metadata de SISTEMA
-- (sem dado de cliente). ADITIVO/IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING. Não toca cálculo nem dado.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('oficina.diagnostico.selecao','Diagnóstico da Oficina','Qual diagnosticar',
 'Indicador (não se preenche). A lista mostra os veículos/OS ativos no pátio para você escolher qual vai diagnosticar; toque no card para abrir o laudo.',
 'Leva você direto ao laudo da OS certa, já com placa, modelo, cliente e a queixa relatada na recepção — sem digitar de novo.',
 'Tocar no card "ABC1D23 · Fiat Uno · barulho ao frear" para começar o diagnóstico dessa OS.',
 'Procurar um veículo que não está aqui: só aparecem OS ativas no pátio — faça a recepção primeiro para o veículo entrar na lista.',
 20,'/dashboard/oficina/diagnostico','oficina','publicado'),
('oficina.diagnostico.selo_laudo','Diagnóstico da Oficina','Selo "já tem laudo"',
 'Indicador (não se preenche). O selo verde "já tem laudo — toque p/ editar" marca as OS que já receberam diagnóstico.',
 'Evita refazer um laudo do zero: mostra de relance o que já foi diagnosticado e o que ainda falta; tocar abre o laudo existente para ajustar.',
 'Card com "✓ já tem laudo — toque p/ editar" = essa OS já foi diagnosticada; toque para revisar peças e serviços.',
 'Achar que o selo cria um laudo novo: ele abre o laudo que já existe para editar, não começa outro.',
 21,'/dashboard/oficina/diagnostico','oficina','publicado')
ON CONFLICT (chave) DO NOTHING;
