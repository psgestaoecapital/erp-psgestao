// Gate (HB0 item 6, CEO 21/10) — a ficha da OS só mostra o campo de oficina "Placa" quando o ramo é automotivo.
// Enquanto o ramo carrega/é desconhecido o comportamento antigo é mantido (regressão zero para a oficina).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
ok(/useOficinaRamo\(os\?\.company_id \?\? null\)/.test(src), 'OrdemServicoCard lê o ramo da empresa da OS')
ok(/const mostraPlaca = !ramoCarregado \|\| ramoCfg\.automotivo/.test(src), 'placa: automotiva por padrão enquanto o ramo carrega')
ok(/\{mostraPlaca && <div[^>]*>\s*<span style=\{lbl\}>Placa/.test(src), 'bloco "Placa" fica atrás de mostraPlaca')
ok(/<AjudaCampo chave="os\.ficha\.placa"/.test(src), 'placa: "?" (RD-95) com chave do banco')
ok(/os\.ficha\.placa/.test(readFileSync('supabase/migrations/20261023172000_os_placa_ajuda_campo.sql', 'utf8')), 'chave os.ficha.placa criada por migration')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
