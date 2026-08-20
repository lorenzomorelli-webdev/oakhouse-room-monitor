export interface TelegramBotCommand {
  command: string;
  description: string;
}

export const TELEGRAM_COMMANDS: TelegramBotCommand[] = [
  {
    command: "start",
    description: "Avvia il bot e mostra la guida",
  },
  {
    command: "status",
    description: "Mostra lo stato di tutti i monitor",
  },
  {
    command: "yen",
    description: "Mostra l'ultimo cambio EUR/JPY",
  },
  {
    command: "test",
    description: "Simula una modifica Oakhouse",
  },
  {
    command: "test_ayntec",
    description: "Simula un nuovo batch AYN",
  },
  {
    command: "test_yen",
    description: "Verifica live il cambio EUR/JPY",
  },
  {
    command: "help",
    description: "Mostra la guida e i link",
  },
];
