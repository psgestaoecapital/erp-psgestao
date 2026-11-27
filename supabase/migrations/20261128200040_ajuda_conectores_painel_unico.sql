-- Parte D (painel de conectores único na Indústria): ajuda de campo ("?", RD-95) da Central de Conectores.
-- Só texto novo, aditivo e idempotente: nenhuma linha existente é alterada, nenhuma tabela de conector
-- (atak_conexao_config, erp_credencial, erp_sync_log) é tocada.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('conectores.central_conectado', '/dashboard/conectores', 'Central de Conectores', 'Conectados nesta empresa',
   'Nada a preencher: o sistema conta os conectores que estão de fato ligados para a empresa escolhida no menu.',
   'Mostra num relance o que já entrega dado. O agente do ERP industrial conta como conectado quando a conexão está ativa e o agente deu sinal nos últimos 30 minutos; os demais, quando há credencial ativa guardada no Vault.',
   '2 conectados: o agente do ERP industrial (sinal há 5 min) e o ponto eletrônico (credencial ativa).',
   'Achar que "Agente sem sinal" é falta de cadastro: a conexão existe, mas o serviço no servidor do cliente parou de reportar — confira a máquina do cliente.',
   'geral', 10),
  ('conectores.central_atak_agente', '/dashboard/conectores', 'Central de Conectores', 'Agente do ERP industrial',
   'Preencha a conexão com o banco do cliente (host, porta, banco, filial, usuário de leitura), escolha os domínios e gere o instalador para o TI.',
   'É o mesmo cadastro da tela Conectores (ERPs) da Indústria: o agente instalado no servidor do cliente coleta os dados e alimenta os painéis.',
   'Host 192.168.20.77 · porta 1433 · coletar a cada 15 min.',
   'Gerar o instalador antes de salvar a conexão: o token do agente só existe depois do salvar.',
   'industria', 20),
  ('conectores.central_credencial', '/dashboard/conectores', 'Central de Conectores', 'Credencial do conector',
   'Cole a chave, conta ou senha que o sistema externo forneceu para esta empresa.',
   'A credencial vai direto para o Vault (cofre criptografado) e é usada só pela sincronização deste conector.',
   'Chave de acesso gerada no painel do sistema externo.',
   'Salvar com a empresa errada selecionada no menu: a credencial fica na empresa que está selecionada no topo.',
   'geral', 30),
  ('conectores.brasilsat_account', '/dashboard/conectores', 'Central de Conectores', 'Conta (rastreamento da frota)',
   'Informe a conta de acesso à API do rastreador, liberada pelo fornecedor do rastreamento para a sua empresa.',
   'Junto com a senha, autentica a sincronização que traz a lista de veículos e a posição atual para o BI de Logística.',
   'A conta liberada para o e-mail de suporte da empresa.',
   'Usar o login do aplicativo de celular do rastreador quando o fornecedor liberou uma conta própria para a API.',
   'industria', 40),
  ('conectores.brasilsat_senha', '/dashboard/conectores', 'Central de Conectores', 'Senha (rastreamento da frota)',
   'Informe a senha da conta da API do rastreador.',
   'Fica só no Vault; a sincronização da frota a usa para pedir um acesso temporário (válido por 2 horas) a cada ciclo.',
   'A senha enviada pelo fornecedor junto com a conta.',
   'Colar espaço no fim da senha: o acesso é recusado. Se a senha mudar no fornecedor, salve de novo aqui.',
   'industria', 50)
ON CONFLICT (chave) DO NOTHING;
