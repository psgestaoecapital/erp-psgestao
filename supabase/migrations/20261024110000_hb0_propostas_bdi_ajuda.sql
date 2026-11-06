-- HB0 (auditor F15 em /dashboard/projetos/propostas · "BDI visível na proposta"): a lista mostra o BDI aplicado em cada
-- proposta contra o BDI padrão da empresa. Só acrescenta os textos do "?" (RD-95) das áreas novas.
-- Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.bdi', 'BDI da proposta', 'Nada a preencher aqui: é o BDI que está nos itens da proposta, médio pelo custo de cada item. Para mudar, abra a proposta e ajuste o BDI do item.', 'O BDI cobre administração central, impostos, seguros, riscos e lucro sobre o custo da obra. Abaixo do padrão da empresa, a proposta pode estar vendendo sem cobrir essas despesas.', '31,9%: igual ao padrão da empresa. "20,0% · abaixo do padrão 31,9%": o preço não cobre todo o BDI.', 'Dar desconto baixando o BDI sem perceber que o lucro ou os impostos deixam de ser cobertos. "sem BDI": os itens foram gravados sem BDI.', 25),
 ('projetos.propostas.bdi_no_padrao', 'BDI no padrão', 'Nada a preencher: conta as propostas cujo BDI está no padrão da empresa (ou acima), sobre as que têm BDI para comparar.', 'Mostra quantas propostas estão saindo com o BDI que a empresa definiu em Configurações — as que ficam abaixo merecem revisão antes de ir ao cliente.', '3 de 5: duas propostas estão com BDI abaixo do padrão.', 'Achar que "—" é zero: sem BDI padrão configurado (ou sem BDI nos itens) não há o que comparar.', 26)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
