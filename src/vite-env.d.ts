/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'fixture' | 'http';
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CATALOG_SNAPSHOT?: string;
  readonly VITE_PRICEBOOK_ID?: string;
  readonly VITE_BUILD_STORE?: 'local' | 'http';
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
