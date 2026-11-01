// Gate · Contrato de preços (auditoria 24/10, item e): saldo contratado + exportação XLS/PDF da medição.
// Sem rede: lê a tela e a migration.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const med = readFileSync('src/app/dashboard/projetos/tabelas-preco/_componentes/MedicaoContrato.tsx', 'utf8')
const sal = readFileSync('src/app/dashboard/projetos/tabelas-preco/_componentes/SaldoContrato.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261025170054_hb2_contrato_saldo_contratado.sql', 'utf8')
ok(/<SaldoContrato /.test(med) && /fn_tabela_preco_saldo'/.test(sal) && /fn_tabela_preco_saldo_gravar/.test(sal), 'tela: saldo contratado dentro da medição, lendo e gravando por RPC')
ok(/podeGravar && \(\s*<div/.test(sal), 'tela: definir contratado só para quem pode gravar')
ok(/Exportar XLS/.test(med) && /Exportar PDF/.test(med) && /med-calc/.test(med) && /med-salva/.test(med), 'tela: XLS/PDF na medição calculada e na salva')
ok(/hub\.tabela_preco\.saldo'/.test(mig) && /saldo_contratada/.test(mig) && /medicao_exportar/.test(mig) && /AjudaCampo chave="hub\.tabela_preco\.saldo"/.test(sal) && /medicao_exportar/.test(med), 'RD-95: "?" com chave no banco')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_tabela_preco_saldo\(uuid\) FROM PUBLIC, anon/.test(mig) && /fn__guarda_empresa/.test(mig) && /BEFORE INSERT OR UPDATE OR DELETE ON public\.erp_tabela_preco_saldo/.test(mig), 'banco: RLS, REVOKE anon, guarda de empresa e trava de consulta')
ok(!/CREATE OR REPLACE VIEW/.test(mig) && !/DROP (TABLE|FUNCTION)/.test(mig), 'banco: aditiva (nada existente reescrito)')
if (falhas) process.exit(1)
