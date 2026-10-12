import { PALETA_IDENTIDADE, auditarCoresFonte } from '../../src/lib/auditores/paletaIdentidade'
const falhas: string[] = []
if (PALETA_IDENTIDADE.espresso !== '#3D2314' || PALETA_IDENTIDADE.offWhite !== '#FAF7F2' || PALETA_IDENTIDADE.dourado !== '#C8941A') falhas.push('paleta de identidade alterada')
const v = auditarCoresFonte('a{color:#3D2314;background:#faf7f2;border:#C8941A;x:#fff;y:#888}\nb{color:#16a34a}\n.semaforo{color:#16a34a}\nc{color:#7c3aed}')
if (v.length !== 2 || v[0].tipo !== 'semaforo_decorativo' || v[0].linha !== 2 || v[1].tipo !== 'fora_da_paleta') falhas.push('auditarCoresFonte: ' + JSON.stringify(v))
if (falhas.length) { console.error('check-paleta-identidade:\n' + falhas.join('\n')); process.exit(1) }
console.log('check-paleta-identidade OK')
