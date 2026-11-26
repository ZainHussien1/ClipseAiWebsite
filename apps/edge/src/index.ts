import { createApp } from './app.js';
export { WorkspaceDO } from './do/workspace.js';
export type { AppDependencies, EdgeBindings, EdgeVariables } from './app.js';

const app = createApp();
export default app;
