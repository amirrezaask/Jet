/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_JET_WEB?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
