import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.korbi.curvecountersimple',
  appName: 'Curve Counter Simple',
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
