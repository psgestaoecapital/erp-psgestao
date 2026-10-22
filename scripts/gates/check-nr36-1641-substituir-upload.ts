// Gate (chamado #1641 · Frioeste): o Histórico de pausas tem o botão de SUBSTITUIR upload (reimportar o relatório do mesmo
// dia substitui o anterior, sem duplicar). Roda no build, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/rpc<[^>]*>\('fn_nr36_upload_substituir', \{ p_upload_id_novo: novo\.id, p_upload_id_antigo: antigoId/.test(tela), 'o histórico chama fn_nr36_upload_substituir (novo, antigo)')
ok(/window\.confirm\([^)]*continua guardado/.test(tela), 'pede confirmação e avisa que o arquivo antigo continua guardado')
ok(/Substituir outro por este/.test(tela), 'a linha do upload processado oferece "Substituir outro por este"')
ok(/o\.status === 'processado'/.test(tela), 'só oferece substituir upload já processado')

if (falhas) { console.error(`\n${falhas} falha(s) (#1641)`); process.exit(1) }
console.log('\nSubstituir upload (#1641): ok')
