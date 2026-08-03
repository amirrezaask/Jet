/// <reference types="vite/client" />

declare module "monaco-editor/min/vs/editor/editor.main.css" {}

declare module "monaco-editor/esm/vs/editor/editor.all.js" {}
declare module "monaco-editor/esm/vs/basic-languages/monaco.contribution.js" {}
declare module "monaco-editor/esm/vs/language/css/monaco.contribution.js" {}
declare module "monaco-editor/esm/vs/language/html/monaco.contribution.js" {}
declare module "monaco-editor/esm/vs/language/json/monaco.contribution.js" {}
declare module "monaco-editor/esm/vs/language/typescript/monaco.contribution.js" {}

declare module "monaco-editor/esm/vs/editor/editor.worker?worker" {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module "monaco-editor/esm/vs/language/json/json.worker?worker" {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module "monaco-editor/esm/vs/language/css/css.worker?worker" {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module "monaco-editor/esm/vs/language/html/html.worker?worker" {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

declare module "monaco-editor/esm/vs/language/typescript/ts.worker?worker" {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}
