/**
 * Modal global de erros.
 *
 * Mostra o que falhou em linguagem direta, com o detalhe técnico recolhido
 * atrás de um toque — quem só quer usar o app fecha e segue; quem precisa
 * diagnosticar tem stack e status HTTP à mão, sem depender de logcat.
 *
 * @see ../context/ErrorContext.tsx
 */
import { useMemo, useState } from "react";
import { Modal, ScrollView, Share, Text, TouchableOpacity, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "@/context/ThemeContext";
import { useErrors } from "@/context/ErrorContext";
import { AppError } from "@/services/errorReporter";
import { makeErrorModalStyles } from "@/styles/errorModal.styles";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function ErrorRow({ error }: { error: AppError }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeErrorModalStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  const accent = error.severity === "warning" ? colors.accent.warning : colors.accent.error;

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <MaterialIcons
          name={error.severity === "warning" ? "warning-amber" : "error-outline"}
          size={18}
          color={accent}
        />
        <Text style={[styles.rowSource, { color: accent }]} numberOfLines={1}>
          {error.source}
        </Text>
        {error.count > 1 && (
          <View style={[styles.badge, { borderColor: accent }]}>
            <Text style={[styles.badgeText, { color: accent }]}>×{error.count}</Text>
          </View>
        )}
        <Text style={styles.rowTime}>{formatTime(error.timestamp)}</Text>
      </View>

      <Text style={styles.rowMessage}>{error.message}</Text>

      {!!error.detail && (
        <>
          <TouchableOpacity
            onPress={() => setExpanded((v) => !v)}
            style={styles.detailToggle}
            accessibilityRole="button"
          >
            <MaterialIcons
              name={expanded ? "expand-less" : "expand-more"}
              size={16}
              color={colors.text.secondary}
            />
            <Text style={styles.detailToggleText}>
              {expanded ? t('errors.hide_detail') : t('errors.show_detail')}
            </Text>
          </TouchableOpacity>
          {expanded && (
            <ScrollView style={styles.detailBox} horizontal={false} nestedScrollEnabled>
              <Text style={styles.detailText}>{error.detail}</Text>
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

export default function ErrorModal() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeErrorModalStyles(colors), [colors]);
  const { errors, visible, close, clear } = useErrors();
  const { t } = useTranslation();

  /**
   * Exporta os erros como texto.
   *
   * Usa `Share` em vez de clipboard porque nenhuma lib de área de transferência
   * está instalada e adicionar uma exigiria rebuild nativo; `Share` é da API
   * do próprio React Native e o destino (colar em outro app) é o mesmo.
   */
  const shareErrors = () => {
    const text = errors
      .map((e) => {
        const when = new Date(e.timestamp).toLocaleTimeString();
        const times = e.count > 1 ? ` (${e.count}x)` : "";
        const detail = e.detail ? `\n   ${e.detail.replace(/\n/g, "\n   ")}` : "";
        return `[${when}] ${e.source}${times}: ${e.message}${detail}`;
      })
      .join("\n\n");
    Share.share({ message: text }).catch(() => {});
  };

  if (errors.length === 0) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <View style={styles.bg}>
        <View style={styles.card}>
          <View style={styles.header}>
            <MaterialIcons name="bug-report" size={26} color={colors.accent.error} />
            <Text style={styles.title}>
              {errors.length === 1
                ? t('errors.title_one')
                : t('errors.title_many', { count: errors.length })}
            </Text>
          </View>
          <Text style={styles.subtitle}>{t('errors.subtitle')}</Text>

          <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
            {errors.map((e) => (
              <ErrorRow key={e.id} error={e} />
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={shareErrors}>
              <MaterialIcons name="content-copy" size={18} color={colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                {t('errors.copy')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={clear}>
              <MaterialIcons name="delete-sweep" size={18} color={colors.text.secondary} />
              <Text style={styles.secondaryBtnText}>{t('errors.clear')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={close}>
              <Text style={styles.primaryBtnText}>{t('errors.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
