/**
 * Configurações do aplicativo.
 *
 * Reúne as preferências que valem para o app inteiro — hoje, as que decidem
 * quanto processamento o reconhecimento consome. A mesma preferência de canais
 * (`config_holistic_enabled`) é editável no modal da tela de câmera; aqui ela
 * aparece com o enquadramento de desempenho, que é o motivo pelo qual alguém
 * procuraria nas configurações em vez de na tela de uso.
 */
import { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Switch, TouchableOpacity } from "react-native";
import Text from "@/components/TranslatableText";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "@/context/ThemeContext";
import { makeAppSettingsStyles } from "@/styles/appSettings.styles";
import { clearLog, getLogSizeKb, setLogEnabled, shareLog } from "@/services/inferenceLogger";
import { Alert } from "@/services/appAlert";

export default function AppSettingsScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeAppSettingsStyles(colors), [colors]);
  const { t } = useTranslation();

  const [holisticEnabled, setHolisticEnabled] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [logEnabled, setLogEnabledState] = useState(false);
  const [logSizeKb, setLogSizeKb] = useState(0);

  useEffect(() => {
    // Lê do AsyncStorage (o módulo do log pode não ter terminado de carregar).
    AsyncStorage.getItem("config_inference_log_enabled").then((v) => setLogEnabledState(v === "true"));
    getLogSizeKb().then(setLogSizeKb).catch(() => {});

    AsyncStorage.getItem("config_holistic_enabled").then((v) => setHolisticEnabled(v === "true"));
    AsyncStorage.getItem("config_show_landmarks").then((v) => setShowLandmarks(v !== "false"));
  }, []);

  const toggleHolistic = (next: boolean) => {
    setHolisticEnabled(next);
    AsyncStorage.setItem("config_holistic_enabled", String(next));
  };

  const toggleShowLandmarks = (next: boolean) => {
    setShowLandmarks(next);
    AsyncStorage.setItem("config_show_landmarks", String(next));
  };

  const toggleLog = async (next: boolean) => {
    setLogEnabledState(next);
    await setLogEnabled(next);
    setLogSizeKb(await getLogSizeKb());
  };

  const handleShareLog = async () => {
    const shared = await shareLog();
    if (!shared) Alert.alert("Log vazio", "Ative o log, use a câmera e tente novamente.");
  };

  const handleClearLog = async () => {
    await clearLog();
    setLogSizeKb(0);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel={t('app_settings.back')}>
          <MaterialIcons name="arrow-back" size={26} color={colors.primary} />
        </TouchableOpacity>
        <Text translatable style={styles.title}>{t('app_settings.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons name="speed" size={20} color={colors.primary} />
            <Text translatable style={styles.sectionTitle}>{t('app_settings.performance')}</Text>
          </View>
          <Text translatable style={styles.sectionDesc}>{t('app_settings.performance_desc')}</Text>

          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text translatable style={styles.rowTitle}>{t('app_settings.holistic')}</Text>
              <Text translatable style={styles.rowDesc}>{t('app_settings.holistic_desc')}</Text>
            </View>
            <Switch
              value={holisticEnabled}
              onValueChange={toggleHolistic}
              trackColor={{ true: colors.primary, false: colors.border.subtle }}
              thumbColor={holisticEnabled ? colors.surface : colors.text.secondary}
            />
          </View>

          {!holisticEnabled && (
            <View style={styles.hint}>
              <MaterialIcons name="info-outline" size={16} color={colors.primary} />
              <Text translatable style={styles.hintText}>{t('app_settings.holistic_off_hint')}</Text>
            </View>
          )}

          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text translatable style={styles.rowTitle}>{t('app_settings.show_landmarks')}</Text>
              <Text translatable style={styles.rowDesc}>{t('app_settings.show_landmarks_desc')}</Text>
            </View>
            <Switch
              value={showLandmarks}
              onValueChange={toggleShowLandmarks}
              trackColor={{ true: colors.primary, false: colors.border.subtle }}
              thumbColor={showLandmarks ? colors.surface : colors.text.secondary}
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons name="bug-report" size={20} color={colors.primary} />
            <Text style={styles.sectionTitle}>Log de diagnóstico</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Grava no aparelho o que o servidor respondeu a cada frame (detector vencedor, confiança e
            movimento) para investigar erros de reconhecimento. Compartilhe o arquivo para análise.
          </Text>

          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Gravar log de inferência</Text>
              <Text style={styles.rowDesc}>Tamanho atual: {logSizeKb} KB</Text>
            </View>
            <Switch
              value={logEnabled}
              onValueChange={toggleLog}
              trackColor={{ true: colors.primary, false: colors.border.subtle }}
              thumbColor={logEnabled ? colors.surface : colors.text.secondary}
            />
          </View>

          <TouchableOpacity style={styles.row} onPress={handleShareLog} activeOpacity={0.7}>
            <Text style={styles.rowTitle}>Compartilhar log</Text>
            <MaterialIcons name="share" size={20} color={colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.row} onPress={handleClearLog} activeOpacity={0.7}>
            <Text style={styles.rowTitle}>Limpar log</Text>
            <MaterialIcons name="delete-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
