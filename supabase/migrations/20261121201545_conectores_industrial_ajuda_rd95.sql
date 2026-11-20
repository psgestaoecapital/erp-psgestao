-- Industrial · Administração · tela "Conectores (ERPs)" (/dashboard/industrial/conectores)
-- — ajuda de campo "?" (RD-95). Code: desenvolvedor_4_g.
--
-- Contexto (aud8 83/95): o formulário de conexão não tinha o "?" obrigatório (RD-95) em
-- nenhum campo nem nas ações. Usuário não-técnico não sabe o que preencher ("Cód. filial",
-- formato do "Banco", porta, etc.). Esta fatia semeia só as chaves de ajuda — NÃO cria/altera
-- tabela, função, RLS nem dado de cliente.
--
-- Aditiva e idempotente: INSERT ... ON CONFLICT (chave) DO NOTHING. erp_ajuda_campo é
-- catálogo global de ajuda (sem company_id, sem dado pessoal). Não altera linha existente.
-- RD-100: texto em marca própria, sem nome de sistema de terceiros.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('conectores.atak_host', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Host / IP',
   'Endereço do servidor da empresa onde roda o banco do sistema do cliente. Pode ser um IP (192.168.x.x) ou um nome de máquina na rede.',
   'É por aqui que o Agente PS encontra o servidor para ler os dados. Sem o endereço certo, a coleta não conecta.',
   '192.168.20.77 (IP fixo do servidor na rede do cliente).',
   'Usar o IP do computador do usuário em vez do servidor: tem de ser a máquina que enxerga o banco de dados.', 1),

  ('conectores.atak_porta', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Porta',
   'Porta de rede em que o banco de dados do cliente aceita conexões. O padrão do SQL Server é 1433; só mude se o TI do cliente usar outra.',
   'Junto com o host, define o endereço exato do banco. Porta errada = conexão recusada.',
   '1433 (padrão). Alguns ambientes usam 1434 ou uma porta específica informada pelo TI.',
   'Deixar em branco ou chutar a porta: confirme com o TI do cliente qual porta o banco escuta.', 2),

  ('conectores.atak_banco', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Banco',
   'Nome do banco de dados (database) do sistema do cliente de onde os dados serão lidos. O TI do cliente informa esse nome.',
   'Diz ao Agente PS de qual base ler as notas, estoque e faturamento. Nome errado = sem acesso aos dados.',
   'SATKFRIOESTE (exemplo de nome de base; o seu é informado pelo TI do cliente).',
   'Confundir o nome do servidor com o nome do banco: são coisas diferentes — aqui vai só o nome da base.', 3),

  ('conectores.atak_cod_filial', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Cód. filial',
   'Código da filial/empresa dentro do sistema do cliente, quando ele controla várias unidades numa mesma base. Informado pelo TI do cliente.',
   'Filtra a coleta para trazer só os dados da unidade certa, evitando misturar números de filiais diferentes.',
   '100 (código da matriz, por exemplo). Cada unidade do cliente costuma ter o seu.',
   'Deixar o padrão sem conferir: se o cliente tem mais de uma filial, confirme o código da unidade que você está conectando.', 4),

  ('conectores.atak_usuario', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Usuário',
   'Usuário de LEITURA do banco de dados do cliente, criado pelo TI dele só para o Agente PS consultar (nunca gravar).',
   'É a identidade com que o Agente PS consulta a base. Usuário com permissão de leitura basta — nada de usuário administrador.',
   'usuario_leitura (um usuário dedicado, só de consulta).',
   'Usar o usuário administrador do cliente: peça ao TI um usuário só de leitura, por segurança.', 5),

  ('conectores.atak_senha', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Senha',
   'Senha do usuário de leitura. Preencher aqui é OPCIONAL: ela fica guardada com segurança (Vault) e você não precisa reenviar a cada vez. No modelo self-service, o TI pode digitá-la 1 vez direto na máquina do cliente.',
   'Completa a credencial de acesso ao banco. Guardada criptografada — nunca aparece em tela depois de salva.',
   'Deixe em branco se o TI vai informar a senha na própria máquina ao instalar o Agente PS.',
   'Reaproveitar a senha do administrador: use a senha do usuário de leitura dedicado.', 6),

  ('conectores.atak_sync_minuto', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Coletar a cada (min)',
   'De quantos em quantos minutos o Agente PS busca dados novos no cliente. O padrão de 15 minutos atende quase tudo.',
   'Controla a frequência da coleta: menor = dados mais frescos, porém mais acessos ao banco do cliente.',
   '15 (a cada 15 minutos). Para ambientes pesados, pode-se usar 30.',
   'Colocar 1 minuto achando que fica "em tempo real": acessos muito frequentes pesam no servidor do cliente sem ganho real.', 7),

  ('conectores.atak_dominios', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Domínios a coletar',
   'Marque quais áreas de dados o Agente PS deve trazer (faturamento, notas, estoque, etc.). Marque só o que esta empresa realmente usa.',
   'Define o escopo da coleta. Trazer só o necessário deixa a sincronização mais rápida e evita ruído.',
   'Marcar "Faturamento (vendas)" e "Posição de estoque" para uma unidade que só precisa desses dois.',
   'Marcar tudo "por garantia": colete só as áreas que a empresa usa, para não sobrecarregar a coleta.', 8),

  ('conectores.atak_ativo', '/dashboard/industrial/conectores', 'Conexão', 'industria',
   'Conexão ativa',
   'Liga ou desliga esta conexão. Desmarque para pausar a coleta sem apagar o cadastro (host, usuário e domínios ficam guardados).',
   'Permite suspender a sincronização de uma empresa temporariamente — em manutenção do cliente, por exemplo — e religar depois.',
   'Desmarcar durante uma migração de servidor do cliente e marcar de novo quando estabilizar.',
   'Apagar a conexão quando só queria pausar: desmarque "Conexão ativa" em vez de excluir o cadastro.', 9),

  ('conectores.atak_salvar', '/dashboard/industrial/conectores', 'Ações', 'industria',
   'Salvar conexão',
   'Grava os dados da conexão. Ao salvar pela primeira vez, o sistema também gera o token do Agente PS desta empresa e guarda a senha no Vault (se você a digitou).',
   'É o passo que registra a conexão e libera o restante do fluxo (testar e gerar o instalador). Sem salvar, não há token.',
   'Preencha host, banco e usuário e clique em "Salvar conexão"; o token aparece logo abaixo.',
   'Esquecer de salvar antes de testar ou gerar o instalador: esses passos dependem do cadastro salvo.', 10),

  ('conectores.atak_testar', '/dashboard/industrial/conectores', 'Ações', 'industria',
   'Testar conexão',
   'Pede ao Agente PS instalado no cliente para fazer um teste rápido de acesso ao banco e devolver o resultado. Disponível só depois de salvar a conexão.',
   'Confirma, em linguagem simples (rede, senha ou banco), se a credencial e o endereço estão certos antes de contar com a coleta.',
   'Clique em "Testar conexão" e aguarde o Agente PS responder no próximo ciclo com OK ou o motivo da falha.',
   'Esperar resposta imediata: o teste roda na rede do cliente e volta no próximo ciclo do agente.', 11),

  ('conectores.atak_gerar_instalador', '/dashboard/industrial/conectores', 'Ações', 'industria',
   'Gerar instalador',
   'Monta o pacote (.zip) de instalação do Agente PS desta empresa, com o token já embutido, para você enviar ao TI do cliente. Liberado só quando o checklist do onboarding está completo.',
   'Entrega ao TI tudo pronto para subir o coletor em poucos minutos, sem configuração manual na máquina do cliente.',
   'Checklist verde? Clique em "Gerar instalador (.zip)", baixe o arquivo e envie ao TI do cliente.',
   'Tentar gerar com o checklist incompleto: resolva as pendências (senha no Vault, domínios, teste) que a tela aponta antes.', 12)
ON CONFLICT (chave) DO NOTHING;
