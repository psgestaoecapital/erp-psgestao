-- RD-95 (CEO 08/10): "?" em todo campo/ação da tela /dashboard/financeiro/conexoes-bancarias.
-- Gap do auditor PDCA: campos do certificado (.crt/.key/senha), teste/sincronizar e a maioria dos campos
-- de boleto estavam sem o "?". Esta migration ADITIVA cadastra as chaves banco.* que faltavam em
-- erp_ajuda_campo (texto em linguagem do usuario). Idempotente: ON CONFLICT (chave) DO NOTHING — nao
-- sobrescreve ajuda ja publicada. Nao toca dado de cliente. (code-desenvolvedor-3)

INSERT INTO public.erp_ajuda_campo
  (id, chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status, criado_em, atualizado_em)
VALUES
  (gen_random_uuid(), 'banco.ambiente', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Ambiente',
   'Escolha Produção para cobrar de verdade ou Homologação para testar sem cobrar.',
   'Separa a conexão de teste da de produção: cada ambiente tem suas próprias credenciais e dados, sem se misturar.',
   'Produção (boleto real) · Homologação (teste).',
   'Deixar em Homologação e estranhar que o boleto não aparece para o cliente: ele foi emitido só no teste.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.client_id', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Client ID',
   'O identificador da aplicação que o banco gerou no portal de desenvolvedores dele.',
   'Identifica a sua empresa junto à API do banco. Vem em par com o Client Secret.',
   'um código/UUID fornecido pelo banco.',
   'Confundir com o Client Secret: o Client ID pode aparecer na tela; o Secret é sigiloso.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.client_secret', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Client Secret',
   'A chave secreta da aplicação, gerada no portal de desenvolvedores do banco. Fica cifrada no cofre.',
   'Autentica a sua empresa na API do banco, junto com o Client ID.',
   'uma sequência longa de letras e números.',
   'Colar com espaço no começo/fim: a autenticação falha. Ao editar, deixe em branco para manter o atual.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.cooperativa', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Cooperativa',
   'O número da cooperativa da sua conta (quando o banco é cooperativo).',
   'Compõe a identificação da conta para o banco localizar extrato e cobrança.',
   '4133.',
   'Informar a cooperativa de outra conta: o banco recusa ou traz dados vazios.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.conta', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Conta corrente',
   'O número da conta corrente, com o dígito.',
   'Junto com a agência, diz ao banco de qual conta buscar o extrato e registrar a cobrança.',
   '12345-6.',
   'Esquecer o dígito ou usar a conta poupança no lugar da corrente.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.codigo_acesso', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Código de Acesso (Internet Banking)',
   'O código de acesso gerado no internet banking para liberar o uso da API. Fica cifrado no cofre.',
   'Autoriza a conexão a usar os serviços de cobrança/extrato em nome da sua conta.',
   'um código gerado na área de integrações do internet banking.',
   'Usar a senha do internet banking no lugar do código de acesso da integração.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.posto', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Posto (código da agência)',
   'O código do posto de atendimento, normalmente com 2 dígitos.',
   'Alguns bancos cooperativos usam o posto junto da agência para localizar a conta.',
   '03.',
   'Deixar em branco quando o banco exige o posto: a conexão não encontra a conta.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.cert_formato', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Formato do certificado',
   'Escolha como o banco te entregou o certificado: um único arquivo (.pfx/.p12) ou o par .crt + .key.',
   'Define quais campos de arquivo aparecem para você enviar o certificado certo.',
   'Um arquivo (.pfx) · Dois arquivos (.crt + .key).',
   'Marcar ".pfx" tendo só o par .crt + .key (ou o contrário): o envio não casa com os arquivos.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.cert_arquivo', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Certificado (.pfx)',
   'Envie o arquivo .pfx (ou .p12) de comunicação bancária que o banco emitiu para a API.',
   'É o certificado que autentica a conexão segura (mTLS) com o banco. Não é o certificado fiscal A1 das notas.',
   'conexao-banco.pfx.',
   'Enviar o A1 fiscal (das notas) no lugar do certificado de comunicação do banco.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.cert_crt', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Certificado (.crt / .pem)',
   'Envie o certificado público (.crt ou .pem) que o banco entregou.',
   'É a parte pública do certificado de comunicação; junto com a chave privada forma o par usado na conexão.',
   'banco.crt.',
   'Enviar a chave privada (.key) no campo do certificado público.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.cert_key', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Chave privada (.key / .pem)',
   'Envie a chave privada (.key ou .pem) do par. Ela fica cifrada no cofre — nunca em texto puro.',
   'É a parte secreta do certificado; sem ela a conexão segura com o banco não fecha.',
   'banco.key.',
   'Trocar a chave privada pelo certificado público: a conexão não autentica.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.cert_key_senha', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Senha da chave (.key)',
   'A senha da própria chave .key, se ela tiver uma. Deixe em branco se não tiver.',
   'Permite abrir a chave privada protegida por senha na hora de montar a conexão.',
   'em branco quando a chave não tem senha.',
   'Confundir com a "Senha do certificado": esta é só da chave .key, quando ela é protegida.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.cert_senha', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Senha do certificado',
   'A senha que protege o certificado .pfx. No formato .crt + .key, defina uma senha — ela protege o .pfx gerado.',
   'Abre o certificado na hora de autenticar a conexão com o banco.',
   'a senha informada pelo banco ao emitir o .pfx.',
   'Digitar a senha errada: o certificado não abre e o teste de conexão falha.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.juros_pct', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', '% de juros (ao mês)',
   'O percentual de juros de mora ao mês cobrado por atraso no boleto. Em branco = sem juros.',
   'O banco aplica esse juros no boleto quando o cliente paga depois do vencimento.',
   '1,5.',
   'Informar o juros ao dia no lugar do ao mês: o valor cobrado fica muito maior.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.dias_juros', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Dias para juros incidir',
   'Quantos dias após o vencimento o juros começa a contar. Em branco = 1 (padrão).',
   'Dá uma carência antes do juros começar a ser cobrado no boleto.',
   '1.',
   'Deixar 0 quando o banco não aceita carência zero: o registro do boleto é recusado.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.multa_pct', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', '% de multa',
   'O percentual de multa por atraso aplicado uma vez sobre o valor do boleto. Em branco = sem multa.',
   'O banco aplica a multa no boleto pago após o vencimento (diferente do juros, que é por tempo).',
   '2.',
   'Confundir multa (uma vez) com juros (por mês de atraso).',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.dias_multa', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Dias para multa incidir',
   'Quantos dias após o vencimento a multa começa. Em branco = 1 (padrão).',
   'Dá uma carência antes de a multa ser cobrada no boleto.',
   '1.',
   'Informar um número muito alto e a multa nunca incidir no prazo esperado.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.instrucoes_boleto', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Instruções para o boleto',
   'Até 4 linhas de texto impressas no boleto (ex.: instruções de protesto, contato). Opcional.',
   'Mostra orientações ao pagador diretamente no boleto emitido.',
   'Após o vencimento, protestar em 5 dias.',
   'Passar de 80 caracteres por linha: o texto é cortado no boleto.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.agencia_dv', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'DV agência',
   'O dígito verificador da agência, quando o banco pede separado do número da agência.',
   'Completa a identificação da agência no arquivo de remessa (CNAB).',
   '2 (da agência 1505-2).',
   'Juntar o dígito ao número da agência quando o campo pede só o dígito.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.recursos', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Recursos habilitados',
   'Marque o que esta conexão vai fazer: emitir boletos e/ou sincronizar o extrato.',
   'Liga só os serviços que você usa neste banco; o extrato só aparece para bancos com conector disponível.',
   'Emitir boletos ✓ · Sincronizar extrato ✓.',
   'Marcar "Sincronizar extrato" em banco sem conector: a opção fica indisponível e nada é importado.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.testar_conexao', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Testar conexão',
   'Clique para validar o certificado e autenticar no banco. É só leitura: não emite boleto nem envia remessa.',
   'Confirma, antes de usar, que as credenciais e o certificado estão corretos. O resultado explica o que fazer se falhar.',
   'resultado "Conexão OK" ou o erro do banco com o que corrigir.',
   'Achar que o teste cobra ou envia algo: ele apenas verifica o acesso.',
   'financeiro', 0, 1, 'publicado', now(), now()),

  (gen_random_uuid(), 'banco.sincronizar_extrato', '/dashboard/financeiro/conexoes-bancarias', 'Conexões bancárias', 'Sincronizar extrato',
   'Clique para buscar no banco os movimentos novos da conta e trazer para o sistema.',
   'Importa os lançamentos do extrato para conciliar com o contas a pagar/receber. Movimentos já trazidos não duplicam.',
   'importou 12 novos movimentos (3 duplicados ignorados).',
   'Esperar ver lançamentos antigos: a sincronização traz a partir do último ponto já importado.',
   'financeiro', 0, 1, 'publicado', now(), now())
ON CONFLICT (chave) DO NOTHING;
