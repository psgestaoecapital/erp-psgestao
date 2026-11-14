-- Papel VENDEDOR COMERCIAL (CEO 06/11, urgentíssimo). Pilar 2 — segurança: o vendedor vê SÓ as próprias vendas,
-- nunca venda de outro, nunca custo/margem/preço de custo da empresa.
--
-- RD-26 (reusar, não recriar): a infraestrutura de ISOLAÇÃO E VÍNCULO JÁ EXISTE e já funciona:
--   • Vínculo usuário→código de vendedor: tabela public.com_vendedor_acesso (RLS por empresa), gravada SÓ pelo
--     administrador em "Administração › Vendedores" via fn_com_vendedor_acesso_salvar (guarda fn_com_vendedor_acesso_pode;
--     o vendedor NÃO escolhe o próprio código; um código = um usuário).
--   • BI pessoal: fn_bi_comercial_painel (tela /dashboard/comercial/meu-painel, já responsiva mobile+desktop) lê o
--     vínculo em com_vendedor_acesso e, quando o usuário está vinculado, trava o escopo no CÓDIGO dele (v_raiz = código;
--     cascata perm/alvo). Usuário sem vínculo e sem papel de direção recebe 'sem_vinculo_vendedor' (bloqueado).
--     A projeção NÃO expõe custo/margem/preço de custo (só valor, volume, R$/kg de venda, desconto vs tabela, clientes…).
--
-- O que FALTAVA e este PR adiciona: o PAPEL formal no catálogo rbac_papel, para a área de Administração cadastrar/vincular
-- o usuário como Vendedor Comercial. O valor do papel em public.tenant_user_roles.role é 'COMMERCIAL_SELLER'
-- (coluna text, sem constraint — já aceito). A segurança efetiva do BI continua sendo o vínculo em com_vendedor_acesso
-- (verificado no servidor por fn_bi_comercial_painel), não o rótulo do papel.
--
-- ADITIVA e idempotente: só acrescenta 1 linha de catálogo de papéis (rbac_papel, PK=slug, sem FKs dependentes).
-- Não cria/altera tabela, não toca RLS/grants, não altera dado de cliente. Timestamp acima da última da main
-- (20261106180045), faixa dev7 (:15).

INSERT INTO public.rbac_papel (slug, vertical, camada, area, nome, descricao, exige_registro, ativo)
VALUES (
  'industria_comercial',
  'industria',
  'especialista',
  'comercial',
  'Vendedor Comercial',
  'Vendedor da equipe comercial. Em "Meu painel de vendas" (/dashboard/comercial/meu-painel) vê SOMENTE as próprias vendas: volume, faturamento, R$/kg, flex (desconto vs tabela), seus clientes, cidades e produtos. NUNCA vê venda de outro vendedor nem custo/margem/preço de custo da empresa. O vínculo usuário→código de vendedor é feito só pelo administrador em Administração › Vendedores (tabela com_vendedor_acesso); a isolação é garantida no servidor por fn_bi_comercial_painel. Papel em tenant_user_roles.role: COMMERCIAL_SELLER.',
  false,
  true
)
ON CONFLICT (slug) DO NOTHING;
