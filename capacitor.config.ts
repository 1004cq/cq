/// <reference types="capacitor-plugin-jpush" />

import type { CapacitorConfig } from '@capacitor/cli';

const isProd = process.env.NODE_ENV === 'production';

const config: CapacitorConfig = {
  appId: 'com.imim.chat',
  appName: 'imimchat',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https',
    url: 'https://wed.imim.chat',
    cleartext: false,
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#FAFAF8',
      showSpinner: false,
    },
    JPush: {
      appKey: '2f496988f16573ad08321835',
      channel: 'App Store',
      isProduction: isProd,
      cleanBadgeWhenActive: true,
    },
  },
};

export default config;
