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
    description: "Mostra lo stato di Oakhouse e AYN",
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
    command: "help",
    description: "Mostra la guida e i link",
  },
];
