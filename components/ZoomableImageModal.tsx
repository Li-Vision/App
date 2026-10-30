import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Image, Modal, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

export type ZoomImage = { uri: string; label: string };

type Props = {
  visible: boolean;
  images: ZoomImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  title?: string;
};

const MAX_SCALE = 5;

/**
 * Visualizador de imagem em tela cheia com pinça para zoom, arraste e toque duplo.
 * Os botões laterais alternam entre as imagens (inicial / movimento / final).
 */
export default function ZoomableImageModal({ visible, images, index, onIndexChange, onClose, title }: Props) {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const reset = () => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  };

  // Cada imagem começa sem zoom.
  useEffect(() => {
    reset();
  }, [index, visible]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden />
      <GestureHandlerRootView style={s.root}>
        <SafeAreaView style={s.root}>
          {current && (
            <GestureDetector gesture={composed}>
              <Animated.View style={[s.imageWrap, animatedStyle]}>
                <Image source={{ uri: current.uri }} style={{ width, height: height * 0.8 }} resizeMode="contain" />
              </Animated.View>
            </GestureDetector>
          )}

          <View style={s.topBar} pointerEvents="box-none">
            <View style={s.titleBox}>
              {!!title && <Text style={s.title} numberOfLines={1}>{title}</Text>}
              {!!current && (
                <Text style={s.label}>{current.label}  ·  {index + 1}/{images.length}</Text>
              )}
            </View>
            <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={12}>
              <MaterialIcons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>

          {hasPrev && (
            <TouchableOpacity style={[s.navBtn, { left: 12 }]} onPress={() => onIndexChange(index - 1)}>
              <MaterialIcons name="chevron-left" size={32} color="#fff" />
            </TouchableOpacity>
          )}
          {hasNext && (
            <TouchableOpacity style={[s.navBtn, { right: 12 }]} onPress={() => onIndexChange(index + 1)}>
              <MaterialIcons name="chevron-right" size={32} color="#fff" />
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  imageWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 36,
    paddingBottom: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  titleBox: { flex: 1, paddingRight: 12 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  label: { color: "#cbd5e1", fontSize: 13, marginTop: 2 },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  navBtn: {
    position: "absolute",
    top: "50%",
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
