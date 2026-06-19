import EmDesenvolvimento from '@/components/shared/EmDesenvolvimento'

export default function MedicaHome() {
  return (
    <EmDesenvolvimento
      icone="⚕️"
      vertical="medica"
      titulo="Clínica Médica"
      descricao="Agenda, PEP, prescrições, exames/laudos e TISS. Financeiro já integrado."
      resumo={
        <ul className="text-left space-y-1 list-disc list-inside">
          <li>Agenda de pacientes</li>
          <li>Prontuário eletrônico (PEP)</li>
          <li>Prescrições / receituário</li>
          <li>Convênios / TISS</li>
          <li>Exames / laudos</li>
        </ul>
      }
    />
  )
}
