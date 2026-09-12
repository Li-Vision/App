/**
 * Modal de configurações da tela de reconhecimento, em duas abas:
 *
 *  - **Exibição**: o que é desenhado sobre a câmera (landmarks das mãos) e
 *    quais canais de detecção rodam (corpo/rosto). O canal holístico não é
 *    só visual: desligá-lo PULA a inferência dos dois modelos no nativo.
 *  - **Voz**: síntese de fala e detecção de soletração — alterna globais
 *    (enabled / speakGestures / spelling) e ajusta ociosidade, estabilidade
 *    da letra e confiança mínima.
 *
 * As duas ficavam em modais separados, acionados por botões distintos na
 * barra da câmera; unir num só reduz a poluição da barra e agrupa o que o
 * usuário pensa como "as configurações desta tela".
 */
import {
    SPEECH_LANGUAGES,
    SpeechPreferences,
    openVoiceDownloadSettings,
    speechService,
} from "@/services/speechService";
import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import {
    Modal,
    ScrollView,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useAppTheme } from "@/context/ThemeContext";
import { makeVoiceSettingsStyles } from "@/styles/voiceSettingsModal.styles";

type Props = {
  visible: boolean;
  prefs: SpeechPreferences;
  onClose: () => void;
  onToggleEnabled: () => void;
  onToggleSpeakGestures: () => void;
  onToggleSpelling: () => void;
  onAdjustIdle: (delta: number) => void;
  onAdjustStable: (delta: number) => void;
  onAdjustConfidence: (delta: number) => void;
  onSetLanguage: (language: string) => void;
  onTestVoice?: () => void;
  /** Aba aberta ao montar — o botão da barra decide qual mostrar primeiro. */
  initialTab?: TabKey;
  // ── Aba "Exibição" ──
  showLandmarks: boolean;
  onToggleShowLandmarks: (next: boolean) => void;
  holisticEnabled: boolean;
  onToggleHolistic: (next: boolean) => void;
};

type TabKey = "display" | "voice";

export default function VoiceSettingsModal({
  visible,
  prefs,
  onClose,
  onToggleEnabled,
  onToggleSpeakGestures,
  onToggleSpelling,
  onAdjustIdle,
  onAdjustStable,
  onAdjustConfidence,
  onSetLanguage,
  onTestVoice,
  initialTab = "display",
  showLandmarks,
  onToggleShowLandmarks,
  holisticEnabled,
  onToggleHolistic,
}: Props) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => makeVoiceSettingsStyles(colors), [colors]);
  const [tab, setTab] = React.useState<TabKey>(initialTab);
  // Reabrir pelo botão de voz deve cair na aba de voz, e vice-versa.
  React.useEffect(() => { if (visible) setTab(initialTab); }, [visible, initialTab]);
  // Mapa idioma → voz instalada no dispositivo. Recalculado ao abrir o modal.
  const [voiceAvailability, setVoiceAvailability] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!visible) return;
    let active = true;
    speechService.ensureVoicesLoaded().then(() => {
      if (!active) return;
      const map: Record<string, boolean> = {};
      SPEECH_LANGUAGES.forEach((lang) => {
        map[lang.speechCode] = speechService.isVoiceAvailable(lang.speechCode);
      });
      setVoiceAvailability(map);
    });
    return () => {
      active = false;
    };
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.bg}>
        <View style={styles.card}>
          <View style={styles.header}>
            <MaterialIcons
              name={tab === "display" ? "grain" : "record-voice-over"}
              size={26}
              color={tab === "display" ? colors.primary : colors.accent.purple}
            />
            <Text style={styles.title}>
              {tab === "display" ? "Exibição & Detecção" : "Voz & Soletração"}
            </Text>
          </View>
          <Text style={styles.subtitle}>
            {tab === "display"
              ? "Escolha o que aparece sobre a câmera e quais modelos rodam."
              : "Configure como o app fala os gestos e reconhece palavras soletradas."}
          </Text>

          <View style={styles.tabBar}>
            {([
              { key: "display" as TabKey, label: "Exibição", icon: "grain" as const },
              { key: "voice" as TabKey, label: "Voz", icon: "record-voice-over" as const },
            ]).map((it) => (
              <TouchableOpacity
                key={it.key}
                style={[styles.tabBtn, tab === it.key && styles.tabBtnActive]}
                onPress={() => setTab(it.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === it.key }}
              >
                <MaterialIcons
                  name={it.icon}
                  size={18}
                  color={tab === it.key ? colors.primary : colors.text.secondary}
                />
                <Text style={[styles.tabText, tab === it.key && styles.tabTextActive]}>
                  {it.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {tab === "display" ? (
              <>
                <View style={styles.row}>
                  <View style={styles.rowTextBlock}>
                    <Text style={styles.rowTitle}>Mostrar landmarks</Text>
                    <Text style={styles.rowDesc}>Desenha os pontos sobre a câmera.</Text>
                  </View>
                  <Switch
                    value={showLandmarks}
                    onValueChange={onToggleShowLandmarks}
                    trackColor={{ true: colors.primary, false: colors.border.subtle }}
                    thumbColor={showLandmarks ? colors.surface : colors.text.secondary}
                  />
                </View>

                <View style={styles.row}>
                  <View style={styles.rowTextBlock}>
                    <Text style={styles.rowTitle}>Mãos</Text>
                    <Text style={styles.rowDesc}>Sempre ativo — base do reconhecimento.</Text>
                  </View>
                  <MaterialIcons name="check-circle" size={22} color={colors.primary} />
                </View>

                <View style={styles.row}>
                  <View style={styles.rowTextBlock}>
                    <Text style={styles.rowTitle}>Corpo e rosto</Text>
                    <Text style={styles.rowDesc}>
                      Necessário para sinais com expressão e postura. Desligar economiza
                      processamento — recomendado em aparelhos mais lentos.
                    </Text>
                  </View>
                  <Switch
                    value={holisticEnabled}
                    onValueChange={onToggleHolistic}
                    trackColor={{ true: colors.primary, false: colors.border.subtle }}
                    thumbColor={holisticEnabled ? colors.surface : colors.text.secondary}
                  />
                </View>
              </>
            ) : (
            <>
            {/* ── Aba de voz ── */}
            {/* ── Toggles ── */}
            <View style={styles.row}>
              <View style={styles.rowTextBlock}>
                <Text style={styles.rowTitle}>Síntese de voz</Text>
                <Text style={styles.rowDesc}>Mestre: liga/desliga todas as falas.</Text>
              </View>
              <Switch
                value={prefs.enabled}
                onValueChange={onToggleEnabled}
                trackColor={{ true: colors.primary, false: colors.border.subtle }}
                thumbColor={prefs.enabled ? colors.surface : colors.text.secondary}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowTextBlock}>
                <Text style={styles.rowTitle}>Falar gesto detectado</Text>
                <Text style={styles.rowDesc}>
                  Pronuncia cada gesto assim que é reconhecido.
                </Text>
              </View>
              <Switch
                value={prefs.speakGestures}
                onValueChange={onToggleSpeakGestures}
                disabled={!prefs.enabled}
                trackColor={{ true: colors.primary, false: colors.border.subtle }}
                thumbColor={prefs.speakGestures ? colors.surface : colors.text.secondary}
              />
            </View>

            <View style={styles.row}>
              <View style={styles.rowTextBlock}>
                <Text style={styles.rowTitle}>Detectar soletração</Text>
                <Text style={styles.rowDesc}>
                  Combina letras em palavras e fala ao terminar.
                </Text>
              </View>
              <Switch
                value={prefs.spellingEnabled}
                onValueChange={onToggleSpelling}
                disabled={!prefs.enabled}
                trackColor={{ true: colors.accent.warning, false: colors.border.subtle }}
                thumbColor={prefs.spellingEnabled ? colors.surface : colors.text.secondary}
              />
            </View>

            {/* ── Sliders simples (+/-) ── */}
            <View style={[styles.languageBlock, !prefs.enabled && { opacity: 0.4 }]}>
              <Text style={styles.languageTitle}>Idioma da voz</Text>
              <Text style={styles.languageDesc}>
                Escolha a voz usada para falar gestos e palavras soletradas.
              </Text>
              <View style={styles.languageGrid}>
                {SPEECH_LANGUAGES.map((language) => {
                  const isActive = prefs.language === language.speechCode;
                  // undefined enquanto carrega → tratamos como disponível.
                  const installed = voiceAvailability[language.speechCode] !== false;

                  return (
                    <TouchableOpacity
                      key={language.speechCode}
                      style={[
                        styles.languageChip,
                        isActive && styles.languageChipActive,
                        !installed && styles.languageChipMissing,
                      ]}
                      onPress={() =>
                        installed ? onSetLanguage(language.speechCode) : openVoiceDownloadSettings()
                      }
                      disabled={!prefs.enabled}
                    >
                      <Text style={[styles.languageChipText, isActive && styles.languageChipTextActive]}>
                        {language.label}
                      </Text>
                      {!installed && (
                        <MaterialIcons name="file-download" size={14} color={colors.accent.warning} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              {Object.values(voiceAvailability).some((v) => v === false) && (
                <Text style={styles.languageMissingHint}>
                  Idiomas com ⬇ não têm voz instalada. Toque para abrir as configurações de
                  voz do sistema e baixar o pacote.
                </Text>
              )}
            </View>

            <Stepper
              label="Finalizar palavra após"
              value={`${(prefs.spellingIdleMs / 1000).toFixed(1)} s`}
              onDec={() => onAdjustIdle(-250)}
              onInc={() => onAdjustIdle(250)}
              disabled={!prefs.spellingEnabled}
              hint="Tempo sem novas letras para considerar a palavra completa."
            />

            <Stepper
              label="Estabilidade da letra"
              value={`${prefs.letterStableMs} ms`}
              onDec={() => onAdjustStable(-100)}
              onInc={() => onAdjustStable(100)}
              disabled={!prefs.spellingEnabled}
              hint="Tempo que a mesma letra deve ser mantida para ser aceita."
            />

            <Stepper
              label="Confiança mínima"
              value={`${(prefs.minConfidence * 100).toFixed(0)}%`}
              onDec={() => onAdjustConfidence(-0.05)}
              onInc={() => onAdjustConfidence(0.05)}
              disabled={!prefs.spellingEnabled}
              hint="Só aceita letras acima deste limiar de confiança."
            />

            {onTestVoice && (
              <TouchableOpacity
                style={styles.testBtn}
                onPress={onTestVoice}
                disabled={!prefs.enabled}
              >
                <MaterialIcons name="play-arrow" size={18} color={colors.primary} />
                <Text style={styles.testBtnText}>Testar voz</Text>
              </TouchableOpacity>
            )}
            </>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
  hint?: string;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => makeVoiceSettingsStyles(colors), [colors]);
  return (
    <View style={[styles.stepperRow, disabled && { opacity: 0.4 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepperLabel}>{label}</Text>
        {hint && <Text style={styles.stepperHint}>{hint}</Text>}
      </View>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          onPress={onDec}
          disabled={disabled}
          style={styles.stepBtn}
        >
          <MaterialIcons name="remove" size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity
          onPress={onInc}
          disabled={disabled}
          style={styles.stepBtn}
        >
          <MaterialIcons name="add" size={18} color={colors.text.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
