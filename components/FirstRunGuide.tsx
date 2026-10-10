import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname } from "expo-router";
import React, { useEffect, useState } from "react";
import AboutModal from "@/components/AboutModal";

/** Muda o sufixo para reexibir o guia a todos após uma mudança grande de UX. */
const SEEN_KEY = "onboardingGuideSeen_v1";
const TOTAL_GUIDES = 4;

/**
 * Mostra os guias da tela "Sobre" (1 a 4) uma única vez por instalação.
 * O layout das abas já fica montado por baixo do login, então a decisão é
 * reavaliada a cada mudança de rota e exige token (usuário logado) fora das
 * telas de login/cadastro. Se o storage falhar, o guia simplesmente não
 * aparece (nunca bloqueia o app).
 */
export default function FirstRunGuide() {
  const [guide, setGuide] = useState<number | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (guide !== null) return;
    if (pathname.startsWith("/screens/login") || pathname.startsWith("/screens/register")) return;

    let cancelled = false;
    Promise.all([AsyncStorage.getItem("userToken"), AsyncStorage.getItem(SEEN_KEY)])
      .then(([token, seen]) => {
        if (!cancelled && token && !seen) setGuide(1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname, guide]);

  const finish = () => {
    setGuide(null);
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {});
  };

  if (guide === null) return null;

  return (
    <AboutModal
      visible
      slide={guide}
      onClose={finish}
      step={{
        current: guide,
        total: TOTAL_GUIDES,
        onNext: () => (guide < TOTAL_GUIDES ? setGuide(guide + 1) : finish()),
        onSkip: finish,
      }}
    />
  );
}
