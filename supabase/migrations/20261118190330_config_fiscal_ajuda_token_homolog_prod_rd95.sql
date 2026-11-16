-- Config Fiscal (/dashboard/configuracoes/fiscal) · Passo 2 · dois tokens do provedor de NF-e — RD-95 "?"
-- ============================================================================
-- #9428 slice2: o card do provedor de NF-e passou de UM campo de token para DOIS
--   (Token de Homologação e Token de Produção). A emissão escolhe o token do
--   ambiente em uso (fn_fiscal_obter_token), então o usuário não precisa recolar
--   o token ao alternar o Ambiente — tira o risco de "produção com token de homologação".
-- CORREÇÃO (aditiva, idempotente): 2 chaves NOVAS de ajuda para os 2 campos novos.
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS, cofre nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: rodrigo-code
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('fiscal.token_homolog', '/dashboard/configuracoes/fiscal', 'Fiscal', 'Token de Homologação',
   'O token (API Key) de HOMOLOGAÇÃO que você gerou no painel do provedor de NF-e. Deixe vazio para manter o token de homologação já salvo.',
   'É a chave usada quando a empresa emite em Homologação (ambiente de teste). Fica guardada em cofre e nunca volta para a tela. A emissão escolhe sozinha o token do ambiente em uso — você não precisa recolar ao trocar de ambiente.',
   'O token de homologação copiado do painel do provedor (um texto longo de letras e números).',
   'Colar aqui o token de PRODUÇÃO: assim a emissão de teste usaria a chave errada. Cada campo é do seu ambiente.',
   'geral', 9262),
  ('fiscal.token_prod', '/dashboard/configuracoes/fiscal', 'Fiscal', 'Token de Produção',
   'O token (API Key) de PRODUÇÃO que você gerou no painel do provedor de NF-e. Deixe vazio para manter o token de produção já salvo.',
   'É a chave usada quando a empresa emite em Produção (notas valendo de verdade). Fica guardada em cofre e nunca volta para a tela. A emissão escolhe sozinha o token do ambiente em uso — você não precisa recolar ao trocar de ambiente.',
   'O token de produção copiado do painel do provedor (um texto longo de letras e números).',
   'Colar aqui o token de HOMOLOGAÇÃO: assim a emissão em produção usaria a chave errada. Cada campo é do seu ambiente.',
   'geral', 9263)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
