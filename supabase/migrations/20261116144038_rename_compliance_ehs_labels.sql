-- Renomear "Compliance" visível -> "EHS" nos rótulos dos catálogos de referência (CEO 14/11).
-- Só RÓTULO visível; a chave técnica (id/grupo/area/vertical = 'compliance') é PRESERVADA (decisão 12/11:
-- rótulo visível = EHS por cima, chave técnica = compliance por baixo). Aditiva, idempotente, sem dado de cliente.
-- Code: code-desenvolvedor-3

-- 1) module_catalog: nome do módulo visível no menu
UPDATE module_catalog
   SET nome = 'Copiloto IA EHS'
 WHERE id = 'compliance_ai_copilot' AND nome = 'Copiloto IA Compliance';

-- 2) feature_catalog: títulos exibidos no inventário/roadmap de funcionalidades
UPDATE feature_catalog
   SET titulo = 'Painel Principal EHS'
 WHERE id = 'F.compliance.painel_principal' AND titulo = 'Painel Principal Compliance';

UPDATE feature_catalog
   SET titulo = 'Copiloto IA - Geracao Documentos EHS'
 WHERE id = 'F.compliance.ai_copilot_cat_jsa' AND titulo = 'Copiloto IA - Geracao Documentos Compliance';

-- 3) erp_ajuda_campo: rótulo do "?" da coluna de conformidade em Funcionários (texto do corpo fica igual)
UPDATE erp_ajuda_campo
   SET rotulo = 'EHS %'
 WHERE chave = 'compliance.funcionarios.col_compliance' AND rotulo = 'Compliance %';
