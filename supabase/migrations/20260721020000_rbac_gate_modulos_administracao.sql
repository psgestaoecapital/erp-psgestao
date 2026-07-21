-- RBAC · T1 · Gatear os 6 módulos de ADMINISTRAÇÃO (Cofre, Conexões Bancárias, Trilha, Conectores ERP,
-- Marketplace integrações, Certificado A1) → pode_ver=false p/ TODOS os níveis menos administrador/socio.
-- Achado do rollout RBAC: RH/gerente viam o Cofre de Credenciais. Aditivo (upsert). Provado (menu):
-- rh industrial passou a ver só ["Folha","Ponto Eletrônico"]. Reverter: _rbac_bkp_permissoes_t1.
WITH adminmod(id) AS (VALUES
 ('78ebbde2-cc7d-496a-bd9e-5a8ebf2ae986'),('49af8f38-9262-41a9-844c-132d8fee4e36'),
 ('admin_trilha_auditoria'),('admin_conectores_erp'),('ge_prev_marketplace_integracoes'),('admin_certificado_a1')),
niv(nivel) AS (VALUES
 ('assessor_admin'),('assessor_usuario'),('cliente_bpo'),('cliente_wealth'),('comercial'),
 ('conselheiro'),('consultor'),('contador_admin'),('contador_viewer'),('coordenador'),
 ('diretor'),('financeiro'),('gerente'),('operacional'),('supervisor'),('visualizador'),
 ('diretor_area'),('gerente_planta'),('gerente_processo'),('supervisor_turno'),
 ('operador'),('rh_industrial'),('sst'))
INSERT INTO permissoes_nivel (modulo_id, nivel, pode_ver, pode_editar, pode_excluir, pode_exportar)
SELECT m.id, n.nivel, false, false, false, false
FROM adminmod m CROSS JOIN niv n
ON CONFLICT (modulo_id, nivel) DO UPDATE
  SET pode_ver=false, pode_editar=false, pode_excluir=false, pode_exportar=false;
