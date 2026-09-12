import React, { useMemo, useState } from "react";
import { View, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Image, StyleSheet } from 'react-native';
import Text from '@/components/TranslatableText';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { makeLoginStyles as makeStyles } from "@/styles/login.styles";
import { useAppTheme } from "@/context/ThemeContext";

export default function LoginScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { handleLogin, handleForgotPassword, loading, recovering } = useAuth();
  const { t } = useTranslation();

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <LinearGradient colors={["rgba(0, 229, 255, 0.1)", "rgba(0,0,0,0)"]} style={StyleSheet.absoluteFill} />
      
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Image source={require('../../../assets/images/Li-Vision-Logo-BackgroundOff.png')} style={{ width: 50, height: 50 }} resizeMode="contain" />
        </View>
        <Text translatable style={styles.title}>{t('login.restricted_access')}</Text>
        <Text translatable style={styles.subtitle}>{t('login.subtitle')}</Text>

        <View style={styles.inputBox}>
          <MaterialIcons name="email" size={20} color="#888" style={styles.icon}/>
          <TextInput
            style={styles.input}
            placeholder={t('login.email')}
            placeholderTextColor="#555"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
        </View>

        <View style={styles.inputBox}>
          <MaterialIcons name="lock" size={20} color="#888" style={styles.icon}/>
          <TextInput
            style={styles.input}
            placeholder={t('login.password')}
            placeholderTextColor="#555"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity
            onPress={() => setShowPassword((v) => !v)}
            // Mesmo padding do ícone da esquerda (styles.icon), para o campo
            // ficar simétrico e o alvo de toque alcançar ~50px.
            style={styles.icon}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? t('login.hide_password') : t('login.show_password')}
          >
            <MaterialIcons
              name={showPassword ? 'visibility-off' : 'visibility'}
              size={20}
              color="#888"
            />
          </TouchableOpacity>
        </View>

        {/* O e-mail do campo acima é reaproveitado: pedir que o usuário digite
            o endereço de novo numa tela à parte só adicionaria atrito. */}
        <TouchableOpacity
          onPress={() => handleForgotPassword(email)}
          disabled={recovering || loading}
          style={styles.forgotBtn}
          accessibilityRole="button"
          accessibilityLabel={t('login.forgot_password')}
        >
          {recovering ? (
            <ActivityIndicator size="small" color={colors.text.secondary} />
          ) : (
            <Text style={styles.forgotText}>{t('login.forgot_password')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.mainBtn} onPress={() => handleLogin(email, password)} disabled={loading}>
          {loading ? <ActivityIndicator color="#0c0f16"/> : (
            <Text style={styles.mainBtnText}>{t('login.enter')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace("/screens/register")} style={styles.toggleBtn}>
          <Text style={styles.toggleText}>{t('login.create_account')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}




