-- Hub · Cockpit (porta de entrada, /dashboard/projetos/cockpit): "?" (RD-95) da ação "Nova obra".
-- Motivo (PDCA Hub 28/10): o auditor pediu "criar nova obra direto desta tela (assistente único HB2)". A tela já lista
-- as obras, mas não tinha o atalho para criar — agora o botão "+ Nova obra" leva ao assistente HB2 (/obras/nova,
-- fn_hub_criar_obra_rapida). Esta migration cadastra o texto de ajuda da ação.
-- Aditiva: só texto de ajuda novo (erp_ajuda_campo); sem dado de cliente, sem RLS. Idempotente: ON CONFLICT (chave) DO NOTHING.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.cockpit.nova_obra', 'Ações', 'Nova obra',
  'Toque para abrir o assistente de nova obra (HB2): informe cliente, nome e/ou endereço e a obra já nasce pronta.',
  'Cria a obra na hora, sem depender de aprovar um orçamento antes — útil para começar a acompanhar custo e avanço de uma obra que já está em campo.',
  'Clicar em "+ Nova obra" → preencher o endereço → a obra é criada e abre o cockpit dela.',
  'Criar obra duplicada: confira na lista se a obra já não existe antes de criar outra.',
  30, '/dashboard/projetos/cockpit')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
