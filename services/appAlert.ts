/**
 * Substituto do `Alert` do React Native com o visual do app.
 *
 * O `Alert.alert` nativo abre o diálogo do sistema (cores, fonte e botões que
 * ignoram o tema claro/escuro do app). Este módulo mantém a MESMA assinatura —
 * `Alert.alert(title, message?, buttons?, options?)` —, então trocar é só
 * mudar o import. Quem desenha o diálogo é o `AppAlertModal`, montado uma vez
 * em `app/_layout.tsx`.
 *
 * Avisos simultâneos entram numa fila e aparecem um de cada vez.
 *
 * @see ../components/AppAlertModal.tsx
 */

export type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

export type AlertOptions = {
  /** Permite fechar tocando fora / no botão voltar. Padrão: true. */
  cancelable?: boolean;
  onDismiss?: () => void;
};

export type AlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options: AlertOptions;
};

type Listener = (request: AlertRequest) => void;

let listener: Listener | null = null;
let nextId = 1;
// Pedidos feitos antes de o modal montar (ou durante o boot) esperam aqui.
const pending: AlertRequest[] = [];

/** Chamado pelo AppAlertModal ao montar/desmontar. */
export function setAlertListener(next: Listener | null): void {
  listener = next;
  if (next) {
    while (pending.length) next(pending.shift()!);
  }
}

export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions,
  ): void {
    const request: AlertRequest = {
      id: nextId++,
      title,
      message,
      buttons: buttons && buttons.length > 0 ? buttons : [{ text: "OK" }],
      options: options ?? {},
    };
    if (listener) listener(request);
    else pending.push(request);
  },
};
