import OdontoEmptyState from '@/components/odonto/OdontoEmptyState';
import { CalendarDays } from 'lucide-react';

export default function Page() {
  return (
    <OdontoEmptyState
      eyebrow="Clínica Odontológica · Processo"
      title="Agenda de Pacientes"
      subtitle="Sua agenda inteligente por cadeira e profissional."
      Icon={CalendarDays}
      cta="Agendar paciente"
      features={[
        { title: 'Agenda por cadeira', desc: 'Horários por cadeira, profissional e tipo de procedimento.' },
        { title: 'Confirmação por WhatsApp', desc: 'Lembretes e confirmações automáticas, sem sair do sistema.' },
        { title: 'Previsão de faltas (IA)', desc: 'A IA sinaliza quem tem risco de faltar e sugere a ação.' },
        { title: 'Encaixe inteligente', desc: 'Horário ocioso vira sugestão de encaixe por recall.' },
      ]}
    />
  );
}
