import { Gesture, getGesturesByLevel, getProgressMap, GestureProgress, LearningLevel, markGestureProgress } from "@/services/learningService";
import { MaterialIcons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Image, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Text from "@/components/TranslatableText";
import ZoomableImageModal, { ZoomImage } from "@/components/ZoomableImageModal";
import { useAppTheme } from "@/context/ThemeContext";

function isLearningLevel(value: string): value is LearningLevel {
  return value === "iniciante" || value === "intermediario" || value === "avancado";
}

const STEP_ICONS = ["pan-tool", "gesture", "front-hand"] as const;

export default function GestureViewerScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ gestureId?: string; level?: string; category?: string; module?: string }>();
  const level: LearningLevel = isLearningLevel(params.level || "") ? (params.level as LearningLevel) : "iniciante";
  const selectedModule = params.module || "Libras";

  const [gestures, setGestures] = useState<Gesture[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, GestureProgress>>({});
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState<{ gesture: Gesture; index: number } | null>(null);
  const listRef = useRef<FlatList<Gesture>>(null);

  useEffect(() => {
    (async () => {
      try {
        const [items, pMap] = await Promise.all([getGesturesByLevel(level, selectedModule), getProgressMap()]);
        const list = params.category ? items.filter((g) => g.category === params.category) : items;
        setGestures(list);
        setProgressMap(pMap);
        const start = Math.max(0, list.findIndex((g) => g.id === params.gestureId));
        setPage(start);
        if (start > 0) setTimeout(() => listRef.current?.scrollToIndex({ index: start, animated: false }), 50);
      } catch (e) {
        console.log("Error loading gestures:", e);
      }
    })();
  }, [level, selectedModule, params.category, params.gestureId]);

  const toggleLearned = async (id: string) => {
    await markGestureProgress(id, progressMap[id]?.learned ? 0 : 100);
    setProgressMap(await getProgressMap());
  };

  const stepsOf = useCallback(
    (g: Gesture): ZoomImage[] => {
      const all = [
        { uri: g.svgInitial, label: t("gesture_detail.step_initial") },
        { uri: g.svgMovement, label: t("gesture_detail.step_movement") },
        { uri: g.svgFinal, label: t("gesture_detail.step_final") },
      ];
      return all.filter((x) => !!x.uri) as ZoomImage[];
    },
    [t]
  );

  const s = useMemo(() => makeStyles(colors), [colors]);
  const imageSize = Math.min(width - 32, height * 0.5);

  const renderPage = ({ item: g }: { item: Gesture }) => {
    const learned = !!progressMap[g.id]?.learned;
    const steps = [g.svgInitial, g.svgMovement, g.svgFinal];
    const available = stepsOf(g);
    return (
      <ScrollView style={{ width }} contentContainerStyle={s.page}>
        <View style={s.nameRow}>
          <Text translatable style={s.name}>{g.name}</Text>
          {learned && (
            <View style={s.check}>
              <MaterialIcons name="check" size={16} color="#fff" />
            </View>
          )}
        </View>
        <Text translatable style={s.category}>{g.category}</Text>
        {!!g.description && <Text translatable style={s.desc}>{g.description}</Text>}
        {available.length > 0 && <Text translatable style={s.hint}>{t("gesture_detail.tap_to_zoom")}</Text>}

        {steps.map((uri, i) => {
          const label = [t("gesture_detail.step_initial"), t("gesture_detail.step_movement"), t("gesture_detail.step_final")][i];
          const zoomIndex = available.findIndex((a) => a.uri === uri);
          return (
            <View key={i} style={s.stepBlock}>
              <Text translatable style={s.stepTitle}>{label}</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={!uri}
                onPress={() => setZoom({ gesture: g, index: Math.max(0, zoomIndex) })}
                style={[s.imageBox, { width: imageSize, height: imageSize }]}
              >
                {uri ? (
                  <>
                    <Image source={{ uri }} style={s.image} resizeMode="contain" />
                    <View style={s.zoomBadge}>
                      <MaterialIcons name="zoom-out-map" size={18} color="#fff" />
                    </View>
                  </>
                ) : (
                  <MaterialIcons name={STEP_ICONS[i]} size={56} color={colors.text.secondary} />
                )}
              </TouchableOpacity>
            </View>
          );
        })}

        <TouchableOpacity
          style={[s.learnBtn, learned ? s.learnedBtn : s.unlearnedBtn]}
          onPress={() => toggleLearned(g.id)}
          activeOpacity={0.7}
        >
          <MaterialIcons name={learned ? "undo" : "check-circle"} size={20} color={learned ? colors.text.muted : colors.background} />
          <Text style={[s.learnText, { color: learned ? colors.text.muted : colors.background }]}>
            {learned ? t("gesture_detail.review_btn") : t("gesture_detail.conclude_btn")}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  const zoomImages = zoom ? stepsOf(zoom.gesture) : [];

  return (
    <SafeAreaView style={s.container}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={s.counter}>{gestures.length ? `${page + 1} / ${gestures.length}` : ""}</Text>
        <View style={s.nav}>
          <TouchableOpacity
            style={[s.iconBtn, page <= 0 && s.disabled]}
            disabled={page <= 0}
            onPress={() => listRef.current?.scrollToIndex({ index: page - 1, animated: true })}
          >
            <MaterialIcons name="chevron-left" size={24} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.iconBtn, page >= gestures.length - 1 && s.disabled]}
            disabled={page >= gestures.length - 1}
            onPress={() => listRef.current?.scrollToIndex({ index: page + 1, animated: true })}
          >
            <MaterialIcons name="chevron-right" size={24} color={colors.text.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={gestures}
        keyExtractor={(g) => g.id}
        renderItem={renderPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      />

      <ZoomableImageModal
        visible={!!zoom}
        images={zoomImages}
        index={zoom?.index ?? 0}
        onIndexChange={(i) => setZoom((z) => (z ? { ...z, index: i } : z))}
        onClose={() => setZoom(null)}
        title={zoom?.gesture.name}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>["colors"]) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.backgroundAlt },
    topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
    nav: { flexDirection: "row", gap: 8 },
    iconBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
    disabled: { opacity: 0.35 },
    counter: { color: colors.text.muted, fontSize: 14, fontWeight: "700" },
    page: { padding: 16, paddingBottom: 48, alignItems: "center" },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    name: { color: colors.text.primary, fontSize: 44, fontWeight: "900", textAlign: "center" },
    check: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#00d084", alignItems: "center", justifyContent: "center" },
    category: { color: colors.primary, fontSize: 14, fontWeight: "700", marginTop: 2 },
    desc: { color: colors.text.alt, fontSize: 16, lineHeight: 23, textAlign: "center", marginTop: 12 },
    hint: { color: colors.text.secondary, fontSize: 12, marginTop: 10 },
    stepBlock: { alignItems: "center", marginTop: 20 },
    stepTitle: { color: colors.text.muted, fontSize: 14, fontWeight: "700", marginBottom: 8 },
    imageBox: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border.subtle,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    image: { width: "100%", height: "100%" },
    zoomBadge: { position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, padding: 6 },
    learnBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, marginTop: 28, alignSelf: "stretch" },
    unlearnedBtn: { backgroundColor: colors.primary },
    learnedBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border.subtle },
    learnText: { fontSize: 15, fontWeight: "800" },
  });
}
