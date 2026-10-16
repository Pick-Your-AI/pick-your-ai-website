/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'fixture' | 'http';
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __PYAI_VERSION__: {
  commit: string;
  builtAt: string;
  contractVersion: string;
  contractSourceSha: string;
  dataMode: 'fixture' | 'http';
};
