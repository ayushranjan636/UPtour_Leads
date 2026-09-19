/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API, including the /api prefix. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
