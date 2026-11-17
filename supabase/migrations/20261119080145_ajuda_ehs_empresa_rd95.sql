-- RD-95: "?" (AjudaCampo) da tela EHS › Documentos da Empresa (/dashboard/ehs/empresa).
-- Contexto (auditoria aud8 17/11, 90/95): a tela tinha ZERO AjudaCampo — colunas (Documento, Tipo, Empresa,
-- Status, Validade, Arquivo, Ações), filtros (Área/Empresa) e ações (Upload/Substituir/Baixar) sem orientação.
-- Estas chaves acompanham os "?" adicionados no page.tsx; o texto vem do banco (RD-95), em linguagem do usuário.
-- Aditiva e idempotente: ON CONFLICT (chave) DO NOTHING. Sem UPDATE/DELETE de dado existente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.empresa.filtro_grupo', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Área',
   'Filtra os documentos por área (Jurídico, Fiscal, Saúde, Segurança, Ambiental). "Todos os grupos" mostra tudo.',
   'Foca a lista na área que você quer conferir, sem rolar por documentos de outras áreas.',
   'Clicar em "Segurança" para ver só PPRA, PGR, laudos de segurança.',
   'Achar que um documento sumiu quando na verdade um filtro de área está ativo — volte para "Todos os grupos".',
   'ehs', 1, 1, 'publicado'),

  ('ehs.empresa.filtro_empresa', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Empresa',
   'Quando você está num grupo, filtra os documentos de uma empresa específica. "Todas" mostra o grupo inteiro.',
   'Permite auditar os documentos de uma empresa por vez dentro do grupo.',
   'Selecionar "Frioeste Filial 2" para ver só a pendência dela.',
   'Comparar empresas com o filtro travado numa só — use "Todas" para ver o grupo.',
   'ehs', 2, 1, 'publicado'),

  ('ehs.empresa.col_documento', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Documento',
   'Nome do tipo de documento exigido da empresa (alvará, licença, laudo). Cada linha é um tipo por empresa.',
   'Mostra o que a empresa precisa ter em dia; é a lista de verificação de conformidade.',
   'Alvará de Funcionamento, AVCB, Licença Ambiental.',
   'Confundir o tipo de documento com o arquivo enviado — o arquivo aparece na coluna Arquivo.',
   'ehs', 3, 1, 'publicado'),

  ('ehs.empresa.col_tipo', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Tipo',
   'Diz se o documento é OBRIGATÓRIO ou OPCIONAL para a empresa, conforme o padrão de conformidade.',
   'Prioriza o que não pode faltar: os obrigatórios pendentes são o foco da regularização.',
   'AVCB = OBRIGATÓRIO; certificado voluntário = OPCIONAL.',
   'Deixar um obrigatório pendente achando que é opcional — confira esta coluna.',
   'ehs', 4, 1, 'publicado'),

  ('ehs.empresa.col_empresa', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Empresa',
   'Mostra a qual empresa do grupo a linha pertence. Aparece só quando você vê um grupo de empresas.',
   'Deixa claro de quem é cada pendência quando a lista junta várias empresas.',
   'Frioeste Matriz, Frioeste Filial 2.',
   'Enviar o documento de uma empresa para a linha de outra — confira a empresa da linha.',
   'ehs', 5, 1, 'publicado'),

  ('ehs.empresa.col_status', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Status',
   'Situação do documento: válido, vencendo, vencido ou não emitido (ainda sem arquivo).',
   'Mostra num relance o que precisa de ação: renovar o que vence e enviar o que falta.',
   'Verde = válido; amarelo = vencendo; vermelho = vencido/não emitido.',
   'Ignorar "vencendo" e deixar virar "vencido", perdendo o prazo de renovação.',
   'ehs', 6, 1, 'publicado'),

  ('ehs.empresa.col_validade', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Validade',
   'Data de validade do documento enviado. Quando está vencendo, mostra em quantos dias vence.',
   'Permite programar a renovação antes do vencimento e evitar multa ou interdição.',
   '31/12/2026 · "em 20d".',
   'Confiar na validade de um arquivo antigo que já foi substituído — veja o arquivo atual na linha.',
   'ehs', 7, 1, 'publicado'),

  ('ehs.empresa.col_arquivo', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Arquivo',
   'Nome do arquivo enviado para este documento. Aparece "—" quando ainda não há arquivo.',
   'Confirma que existe um comprovante anexado e qual é o arquivo vigente.',
   'alvara_2026.pdf.',
   'Ver "—" e achar que o documento existe — sem arquivo, o status fica "não emitido".',
   'ehs', 8, 1, 'publicado'),

  ('ehs.empresa.col_acoes', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Ações',
   'Botões para enviar, substituir ou baixar o arquivo do documento daquela linha.',
   'Concentra o envio e a consulta do comprovante na própria linha, sem abrir outra tela.',
   'Clicar em Upload para anexar o alvará, ou Baixar para conferir o atual.',
   'Substituir um arquivo válido por engano — use Baixar antes para conferir qual está lá.',
   'ehs', 9, 1, 'publicado'),

  ('ehs.empresa.upload', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Upload',
   'Anexa pela primeira vez o arquivo (PDF/imagem) do documento e informa emissão e validade.',
   'Registra o comprovante e calcula o status (válido/vencendo) a partir da validade informada.',
   'Enviar o AVCB em PDF com validade 31/12/2026.',
   'Enviar um arquivo sem data de validade correta — o status de vencimento fica errado.',
   'ehs', 10, 1, 'publicado'),

  ('ehs.empresa.substituir', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Substituir',
   'Troca o arquivo atual por uma versão nova (renovação) e atualiza emissão e validade.',
   'Mantém o documento em dia após renovar, sem perder o histórico do anterior.',
   'Substituir o alvará vencido pelo renovado.',
   'Substituir por um arquivo errado — confira o tipo e a validade antes de confirmar.',
   'ehs', 11, 1, 'publicado'),

  ('ehs.empresa.baixar', '/dashboard/ehs/empresa', 'EHS · Documentos da Empresa', 'Baixar',
   'Baixa o arquivo vigente do documento para consulta ou envio a terceiros.',
   'Dá acesso rápido ao comprovante sem sair do sistema.',
   'Baixar a Licença Ambiental para anexar numa fiscalização.',
   'Baixar uma versão antiga achando que é a atual — a linha mostra sempre o arquivo vigente.',
   'ehs', 12, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
