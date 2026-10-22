// Gate (chamado #74 · Frioeste · 05/10): a aba Ciência tem o botão "Anexar assinado" na própria linha do colaborador
// (upload do documento assinado à mão), sem precisar abrir o documento. Roda no build, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/ciencia-anexar-\$\{l\.cpf\}/.test(tela), 'a linha do colaborador tem o botão Anexar assinado')
ok(/anexarAssinadoLinha[\s\S]{0,700}fn_nr36_ciencia_anexar_assinado', \{ p_id: l\.id/.test(tela), 'o upload grava pelo fn_nr36_ciencia_anexar_assinado')
ok(/l\.status !== 'assinado' && <>[\s\S]{0,900}ciencia-anexar-/.test(tela), 'o botão só aparece enquanto o documento não está assinado')

if (falhas) { console.error(`\n${falhas} falha(s) no anexar assinado na lista (#74)`); process.exit(1) }
console.log('\nAnexar assinado na lista da Ciência (#74): ok')
