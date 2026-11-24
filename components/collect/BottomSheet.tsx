import { MaterialIcons } from "@expo/vector-icons";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "@/context/ThemeContext";
import { makeCollectPickerStyles } from "@/styles/collect-picker.styles";

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  closeLabel: string;
  children: ReactNode;
};

const OPEN_MS = 260;
const CLOSE_MS = 180;

/**
 * Painel que sobe da borda inferior, usado pelos seletores da coleta.
 *
 * Fica perto do polegar e mantém a câmera visível acima dele, ao contrário de
 * um diálogo centralizado. O fundo escurece por opacidade e o painel desliza
 * por translateY: animar o Modal inteiro com "slide" arrastaria o fundo junto.
 */
export default function BottomSheet({ visible, onClose, title, subtitle, closeLabel, children }: Props) {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeCollectPickerStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: CLOSE_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [480, 0] });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.sheetWrap}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={closeLabel} />
        </Animated.View>

        <Animated.View
          style={[s.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}
          accessibilityViewIsModal
        >
          <View style={s.grabber} />
          <View style={s.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetTitle} accessibilityRole="header">{title}</Text>
              {subtitle ? <Text style={s.sheetSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
            <Pressable onPress={onClose} style={s.closeBtn} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={4}>
              <MaterialIcons name="close" size={24} color={colors.text.muted} />
            </Pressable>
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
