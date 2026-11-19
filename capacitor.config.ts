import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.korbi.simplecurvecounter',
  appName: 'Simple Curve Counter',
  webDir: 'dist',
  backgroundColor: '#14161a',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;
