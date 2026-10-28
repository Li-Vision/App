import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

/**
 * Notificação de progresso do treino.
 *
 * Uma única notificação, de identificador fixo, é reescrita a cada atualização:
 * assim a porcentagem e o tempo restante aparecem na barra de status mesmo com
 * o modal oculto ou o app em segundo plano. Falhas aqui nunca podem atrapalhar
 * o treino, então tudo é engolido.
 */
const NOTIFICATION_ID = "training-progress";
const CHANNEL_PROGRESS = "training-progress";
const CHANNEL_RESULT = "training-result";

// Quanto mínimo entre duas atualizações visíveis (o Android descarta notificações
// postadas em rajada) e variação mínima de porcentagem que justifica atualizar.
const MIN_UPDATE_INTERVAL_MS = 3000;

let handlerSet = false;
let channelsReady = false;
let lastUpdateAt = 0;
let lastPercent = -1;

function ensureHandler() {
  if (handlerSet) return;
  handlerSet = true;
  // Com o app em primeiro plano o sistema também deve mostrar a notificação.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannels() {
  if (channelsReady || Platform.OS !== "android") return;
  // Progresso em importância baixa: aparece sem som nem vibração a cada update.
  await Notifications.setNotificationChannelAsync(CHANNEL_PROGRESS, {
    name: "Progresso do treinamento",
    importance: Notifications.AndroidImportance.LOW,
    vibrationPattern: [0],
    enableVibrate: false,
    showBadge: false,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_RESULT, {
    name: "Resultado do treinamento",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  channelsReady = true;
}

/** Pede a permissão (Android 13+ / iOS). Devolve se as notificações estão liberadas. */
export async function requestTrainingNotificationPermission(): Promise<boolean> {
  try {
    ensureHandler();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

/** Segundos restantes estimados pela taxa média de progresso, ou null se ainda cedo. */
export function estimateRemainingSeconds(progress: number, elapsedSeconds: number): number | null {
  if (progress <= 5 || progress >= 100 || elapsedSeconds <= 3) return null;
  return ((100 - progress) / progress) * elapsedSeconds;
}

export function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}s`;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

async function post(title: string, body: string, channel: string, ongoing: boolean) {
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title,
      body,
      sticky: ongoing, // Android: não some ao deslizar enquanto o treino roda
      autoDismiss: !ongoing,
      ...(Platform.OS === "android" ? { channelId: channel } : {}),
    } as Notifications.NotificationContentInput,
    trigger: null,
  });
}

/** Atualiza a notificação de andamento. Chamada a cada ciclo de polling. */
export async function notifyTrainingProgress(
  title: string,
  progress: number,
  remainingSeconds: number | null,
  texts: { body: (percent: number, eta: string) => string; calculating: (percent: number) => string },
) {
  try {
    const percent = Math.max(0, Math.min(99, Math.round(progress)));
    const now = Date.now();
    if (percent === lastPercent || now - lastUpdateAt < MIN_UPDATE_INTERVAL_MS) return;
    ensureHandler();
    await ensureChannels();
    lastUpdateAt = now;
    lastPercent = percent;
    const body =
      remainingSeconds === null
        ? texts.calculating(percent)
        : texts.body(percent, formatRemaining(remainingSeconds));
    await post(title, body, CHANNEL_PROGRESS, true);
  } catch {
    /* notificação é opcional */
  }
}

/** Troca a notificação de andamento pela de resultado (sucesso ou falha). */
export async function notifyTrainingFinished(title: string, body: string) {
  try {
    ensureHandler();
    await ensureChannels();
    lastUpdateAt = 0;
    lastPercent = -1;
    await post(title, body, CHANNEL_RESULT, false);
  } catch {
    /* notificação é opcional */
  }
}

/** Remove a notificação (ex.: treino não chegou a iniciar). */
export async function clearTrainingNotification() {
  try {
    lastUpdateAt = 0;
    lastPercent = -1;
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch {
    /* notificação é opcional */
  }
}
