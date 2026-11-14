// #3862/#3863 etapa 2 — a validação da NFS-e de obra aceita CNO OU endereço completo (opção A da Jordana).
import { readFileSync } from 'node:fs'
const sql = readFileSync('supabase/migrations/20261111220020_nfse_validar_obra_cno_ou_endereco_3862.sql', 'utf8')
const falhas: string[] = []
if (!/CREATE OR REPLACE FUNCTION public\.fn_nfse_validar_emissao/.test(sql)) falhas.push('falta a função')
if (!/COALESCE\(btrim\(v_obra_cno\),''\) = '' AND v_dig_cno = ''/.test(sql)) falhas.push('obra com CNO deve dispensar o endereço')
if (!/v_dig_end/.test(sql)) falhas.push('endereço digitado sem obra deve valer')
if (!/SECURITY DEFINER[\s\S]*SET search_path TO 'public'/.test(sql)) falhas.push('perdeu SECURITY DEFINER/search_path')
if (!/Sem acesso a esta empresa/.test(sql)) falhas.push('perdeu a guarda de empresa')
if (falhas.length) { console.error('✗ check-nfse-obra-cno-ou-endereco:\n - ' + falhas.join('\n - ')); process.exit(1) }
console.log('✓ check-nfse-obra-cno-ou-endereco')
