// Gate · Contrato de preços (auditoria 24/10, item e): saldo contratado + PDF/Excel da medição, com "?" no banco. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const d = 'src/app/dashboard/projetos/tabelas-preco/_componentes/'
const med = readFileSync(d + 'MedicaoContrato.tsx', 'utf8')
const saldo = readFileSync(d + 'SaldoContratado.tsx', 'utf8')
const exp = readFileSync(d + 'exportarMedicao.ts', 'utf8')
const mig = readFileSync('supabase/migrations/20261025190054_hb2_contrato_saldo_contratado.sql', 'utf8')
ok(/<SaldoContratado[^>]*podeGravar=\{podeGravar\}/.test(med) && /podeGravar && \(\s*<div/.test(saldo), 'tela: saldo na medição; definir só para quem pode gravar')
ok(/med-pdf/.test(med) && /med-xls/.test(med) && /XLSX\.writeFile/.test(exp) && /w\.print\(\)/.test(exp), 'medição: botões PDF e Excel geram o arquivo')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_tabela_preco_saldo FROM anon/.test(mig) && /trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public\.erp_tabela_preco_saldo/.test(mig) && /fn__guarda_empresa/.test(mig), 'banco: RLS, REVOKE anon, trava de consulta e guarda de empresa')
const chaves = [...(saldo + med).matchAll(/chave="(hub\.tabela_preco\.(?:saldo|saldo_contratado|medicao_exportar))"/g)].map((m) => m[1])
ok(['hub.tabela_preco.saldo', 'hub.tabela_preco.saldo_contratado', 'hub.tabela_preco.medicao_exportar'].every((c) => chaves.includes(c) && mig.includes(`'${c}'`)), '"?" (RD-95): 3 chaves usadas na tela e criadas na migration')
if (falhas) process.exit(1)
