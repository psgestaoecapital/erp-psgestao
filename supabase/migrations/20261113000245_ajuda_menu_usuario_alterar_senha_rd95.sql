-- RD-95 (CEO 08/10): "?" nos campos do modal "Alterar minha senha" do menu do usuário (chamado #7899).
-- O modal (src/components/layout/AlterarSenhaModal.tsx) tem 3 campos de senha (atual, nova, confirmar) e abre de
-- qualquer tela, por isso usa uma rota própria ("menu-usuario") passada ao <AjudaCampo>; sem ela os textos não
-- resolveriam contra o pathname da página em que o usuário estiver.
-- Aditivo: só texto em erp_ajuda_campo (sem tabela nova, sem RLS, sem dado de cliente). Idempotente (ON CONFLICT chave).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, 'menu-usuario', 'admin', 'publicado'
FROM (VALUES
 ('menu_usuario.senha_atual', 'Alterar minha senha', 'Senha atual',
  'Digite a senha que você usa hoje para entrar no sistema.',
  'Confere que é você mesmo antes de permitir a troca — o sistema só muda a senha se a atual estiver correta.',
  'A mesma senha que você usou para entrar agora.',
  'Errar a senha atual: a troca não é feita. Se esqueceu, saia e use "Esqueci minha senha" na tela de login.',
  1),
 ('menu_usuario.senha_nova', 'Alterar minha senha', 'Nova senha',
  'Escolha a nova senha, com no mínimo 8 caracteres; use letras e números para ficar mais forte.',
  'É a senha que passará a valer no próximo acesso, inclusive no aplicativo do celular.',
  'Uma combinação só sua, como "Sol2026#casa".',
  'Usar menos de 8 caracteres ou repetir a senha atual: o sistema não aceita e avisa na tela.',
  2),
 ('menu_usuario.senha_confirmar', 'Alterar minha senha', 'Confirmar nova senha',
  'Digite de novo a nova senha, exatamente igual, para evitar erro de digitação.',
  'Garante que você memorizou/escreveu a senha certa antes de salvar.',
  'Repita o mesmo texto do campo "Nova senha".',
  'Digitar diferente da nova senha: aparece "A confirmação não é igual à nova senha" e a troca não é salva.',
  3)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
