-- Backfill do codigo_ibge_municipio dos clientes da PS em São Miguel do Oeste/SC (→ 4217204).
-- Necessário pro layout NFSe Nacional (cMun do tomador). GO do CEO. Backup em rls2_backup.erp_clientes_ibge_bkp_20260722.
-- Idempotente: só preenche quem está NULL/'' e é de São Miguel do Oeste/SC. Demais cidades: preenchem sozinhos ao
-- salvar o cliente (auto-lookup ViaCEP no submit do ClienteForm) quando tiverem CEP.
UPDATE public.erp_clientes
   SET codigo_ibge_municipio='4217204', updated_at=now()
 WHERE company_id='b26c19c0-bf6d-495b-b8d1-9fa8d6896725'
   AND (codigo_ibge_municipio IS NULL OR codigo_ibge_municipio='')
   AND uf='SC' AND cidade ILIKE '%miguel do oeste%';
