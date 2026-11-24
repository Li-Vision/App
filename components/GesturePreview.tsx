/**
 * Desenha uma amostra GRAVADA como esqueleto de mão (pontos + ossos).
 *
 * Reaproveita o LandmarkOverlay da câmera com um mapeador que enquadra o gesto
 * no quadro. Sequências dinâmicas tocam em loop, com o rastro do pulso para
 * mostrar a trajetória; tocar no quadro pausa/retoma.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { TouchableOpacity, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import Text from "@/components/TranslatableText";
import LandmarkOverlay from "@/components/LandmarkOverlay";
import { decodeGesture, fitMapper } from "@/lib/gesturePoints";

type Props = {
  features: unknown;
  size?: number;
  /** Texto curto no canto (ex.: "Gravado" / "Típico de B"). */
  caption?: string;
  accent?: string;
};

const FRAME_MS = 90;

function GesturePreviewBase({ features, size = 150, caption, accent = "#00e5ff" }: Props) {
  const gesture = useMemo(() => decodeGesture(features), [features]);
  const cover = useMemo(() => (gesture ? fitMapper(gesture, size, size) : null), [gesture, size]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const total = gesture?.frames.length ?? 0;

  useEffect(() => { setFrame(0); }, [features]);
  useEffect(() => {
    if (total < 2 || !playing) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % total), FRAME_MS);
    return () => clearInterval(id);
  }, [total, playing]);

  const box = {
    width: size,
    height: size,
    borderRadius: 10,
    backgroundColor: "#0b1620",
    borderWidth: 1,
    borderColor: accent,
    overflow: "hidden" as const,
  };

  if (!gesture || !cover) {
    return (
      <View style={[box, { alignItems: "center", justifyContent: "center", borderColor: "#555" }]}>
        <MaterialIcons name="block" size={28} color="#777" />
        <Text style={{ color: "#888", fontSize: 11, marginTop: 4, textAlign: "center" }}>
          {features ? "Sem mão para desenhar" : "Sem exemplo"}
        </Text>
        {caption ? <Text style={{ color: "#888", fontSize: 11 }}>{caption}</Text> : null}
      </View>
    );
  }

  const current = gesture.frames[Math.min(frame, total - 1)];
  // Rastro: pulso da 1ª mão em cada frame até o atual.
  const trail = total > 1
    ? gesture.frames.slice(0, frame + 1).map((f) => f.hands[0]?.[0]).filter(Boolean)
    : [];

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => setPlaying((p) => !p)} disabled={total < 2}>
      <View style={box}>
        {trail.map((p, i) => (
          <View
            key={`trail-${i}`}
            style={{
              position: "absolute",
              left: cover.toX(p!.x) - 2,
              top: cover.toY(p!.y) - 2,
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: "rgba(255,107,107,0.5)",
            }}
          />
        ))}
        <LandmarkOverlay hands={current.hands} cover={cover} />

        {caption ? (
          <Text style={{ position: "absolute", left: 6, top: 4, color: accent, fontSize: 11, fontWeight: "bold" }}>
            {caption}
          </Text>
        ) : null}
        {total > 1 && (
          <View style={{ position: "absolute", right: 6, bottom: 4, flexDirection: "row", alignItems: "center", gap: 2 }}>
            <MaterialIcons name={playing ? "pause" : "play-arrow"} size={12} color="#aaa" />
            <Text style={{ color: "#aaa", fontSize: 10 }}>{frame + 1}/{total}</Text>
          </View>
        )}
        {gesture.layout === "box" && (
          <Text style={{ position: "absolute", left: 6, bottom: 4, color: "#777", fontSize: 9 }}>
            proporção aproximada
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export const GesturePreview = memo(GesturePreviewBase);
export default GesturePreview;
